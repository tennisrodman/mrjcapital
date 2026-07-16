from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.db.models.deletion import ProtectedError
from rest_framework import viewsets
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated

from api.contact_serializers import ContactSerializer, DealContactSerializer
from api.drf import uuid_filter_value as _uuid_filter_value
from api.models.contact import Contact, DealContact
from api.models.deal import Deal
from api.policies import can_access_deal as _can_access_deal, is_staff_user as _is_staff_user
from api.services.contacts import (
    create_deal_contact,
    delete_deal_contact,
    update_deal_contact,
)


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
        try:
            serializer.instance = create_deal_contact(
                deal=deal,
                contact=contact,
                role=serializer.validated_data['role'],
                is_primary=serializer.validated_data.get('is_primary', False),
                notes=serializer.validated_data.get('notes', ''),
                performed_by=self.request.user,
            )
        except DjangoValidationError as exc:
            _raise_service_validation(exc)

    def perform_update(self, serializer):
        mutable_fields = {
            field: value
            for field, value in serializer.validated_data.items()
            if field in {'is_primary', 'notes'}
        }
        try:
            serializer.instance = update_deal_contact(
                serializer.instance,
                performed_by=self.request.user,
                **mutable_fields,
            )
        except DjangoValidationError as exc:
            _raise_service_validation(exc)

    def perform_destroy(self, instance):
        delete_deal_contact(instance, performed_by=self.request.user)
def _can_access_contact(user, contact):
    if not getattr(user, 'is_authenticated', False):
        return False
    if _is_staff_user(user) or contact.created_by_id == user.id:
        return True
    return contact.deal_links.filter(deal__assigned_analyst=user).exists()


def _raise_service_validation(exc):
    if hasattr(exc, 'message_dict'):
        raise ValidationError(exc.message_dict) from exc
    raise ValidationError({'detail': exc.messages}) from exc
