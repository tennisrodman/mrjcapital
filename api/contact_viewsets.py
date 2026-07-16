from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from rest_framework import viewsets
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from api.contact_serializers import ContactSerializer, DealContactSerializer
from api.models.contact import Contact, DealContact
from api.models.deal import Deal
from api.policies import can_access_deal as _can_access_deal, is_staff_user as _is_staff_user


class ContactViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = ContactSerializer
    queryset = Contact.objects.all()

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(
                Q(created_by=self.request.user)
                | Q(deal_links__deal__assigned_analyst=self.request.user),
            ).distinct()
        search = self.request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(full_name__icontains=search)
                | Q(company_name__icontains=search)
                | Q(email__icontains=search)
            )
        return queryset

    def perform_create(self, serializer):
        self._save_contact(serializer, created_by=self.request.user)

    def perform_update(self, serializer):
        self._require_exclusive_access(serializer.instance)
        self._save_contact(serializer)

    def perform_destroy(self, instance):
        self._require_exclusive_access(instance)
        try:
            instance.delete()
        except ProtectedError as exc:
            raise ValidationError({
                'detail': 'This contact is attached to one or more deals and cannot be deleted.',
            }) from exc

    def _require_exclusive_access(self, contact):
        if _is_staff_user(self.request.user):
            return
        if contact.deal_links.exclude(deal__assigned_analyst=self.request.user).exists():
            raise PermissionDenied('A shared contact can only be changed by staff.')

    def _save_contact(self, serializer, **save_kwargs):
        try:
            with transaction.atomic():
                serializer.save(**save_kwargs)
        except IntegrityError as exc:
            raise ValidationError({
                'detail': 'The contact conflicts with an existing person record.',
            }) from exc


class DealContactViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    serializer_class = DealContactSerializer
    queryset = DealContact.objects.select_related('deal', 'contact')

    def create(self, request, *args, **kwargs):
        deal_id = request.data.get('deal')
        contact_id = request.data.get('contact')
        if deal_id:
            deal = Deal.objects.filter(pk=_uuid_filter_value(deal_id, 'deal')).first()
            if not deal or not _can_access_deal(request.user, deal):
                raise NotFound()
        if contact_id:
            contact = Contact.objects.filter(pk=_uuid_filter_value(contact_id, 'contact')).first()
            if not contact or not _can_access_contact(request.user, contact):
                raise NotFound()
        return super().create(request, *args, **kwargs)

    def get_queryset(self):
        queryset = super().get_queryset()
        if not _is_staff_user(self.request.user):
            queryset = queryset.filter(deal__assigned_analyst=self.request.user)
        deal_id = self.request.query_params.get('deal')
        if deal_id:
            queryset = queryset.filter(deal=_uuid_filter_value(deal_id, 'deal'))
        role = self.request.query_params.get('role')
        if role:
            valid_roles = {choice for choice, _ in DealContact._meta.get_field('role').choices}
            if role not in valid_roles:
                raise ValidationError({'role': 'Unsupported deal contact role.'})
            queryset = queryset.filter(role=role)
        return queryset

    def perform_create(self, serializer):
        deal = serializer.validated_data['deal']
        contact = serializer.validated_data['contact']
        if not _can_access_deal(self.request.user, deal) or not _can_access_contact(
            self.request.user,
            contact,
        ):
            raise NotFound()
        self._save_with_deal_lock(serializer)

    def perform_update(self, serializer):
        self._save_with_deal_lock(serializer)

    def _save_with_deal_lock(self, serializer):
        deal = serializer.validated_data.get('deal') or serializer.instance.deal
        contact = serializer.validated_data.get('contact') or serializer.instance.contact
        role = serializer.validated_data.get('role') or serializer.instance.role
        is_primary = serializer.validated_data.get(
            'is_primary',
            getattr(serializer.instance, 'is_primary', False),
        )
        try:
            with transaction.atomic():
                Deal.objects.select_for_update().get(pk=deal.pk)
                duplicate = DealContact.objects.filter(deal=deal, contact=contact, role=role)
                primary = DealContact.objects.filter(deal=deal, role=role, is_primary=True)
                if serializer.instance:
                    duplicate = duplicate.exclude(pk=serializer.instance.pk)
                    primary = primary.exclude(pk=serializer.instance.pk)
                if duplicate.exists():
                    raise ValidationError({
                        'non_field_errors': 'This contact already has that role on the deal.',
                    })
                if is_primary and primary.exists():
                    raise ValidationError({
                        'is_primary': 'This deal already has a primary contact for that role.',
                    })
                serializer.save()
        except IntegrityError as exc:
            raise ValidationError({
                'detail': 'The contact link conflicts with an existing deal contact.',
            }) from exc


def _uuid_filter_value(value, field_name):
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise ValidationError({field_name: 'Invalid UUID.'}) from exc


def _can_access_contact(user, contact):
    if not getattr(user, 'is_authenticated', False):
        return False
    if _is_staff_user(user) or contact.created_by_id == user.id:
        return True
    return contact.deal_links.filter(deal__assigned_analyst=user).exists()
