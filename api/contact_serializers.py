from rest_framework import serializers

from api.models.contact import Contact, DealContact


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = Contact
        fields = [
            'id',
            'full_name',
            'title',
            'company_name',
            'email',
            'phone',
            'details',
            'created_by',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_by', 'created_at', 'updated_at']

    def validate_full_name(self, value):
        value = value.strip()
        if not value:
            raise serializers.ValidationError('Contact name cannot be empty.')
        return value

    def validate_email(self, value):
        return value.strip().lower()


class DealContactSerializer(serializers.ModelSerializer):
    contact_detail = ContactSerializer(source='contact', read_only=True)

    class Meta:
        model = DealContact
        fields = [
            'id',
            'deal',
            'contact',
            'contact_detail',
            'role',
            'is_primary',
            'notes',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['created_at', 'updated_at']

    def validate(self, attrs):
        if self.instance:
            for field_name in ('deal', 'contact', 'role'):
                if field_name in attrs and attrs[field_name] != getattr(self.instance, field_name):
                    raise serializers.ValidationError(
                        {field_name: f'{field_name} cannot be changed after creation.'}
                    )

        deal = attrs.get('deal') or getattr(self.instance, 'deal', None)
        role = attrs.get('role') or getattr(self.instance, 'role', None)
        is_primary = attrs.get('is_primary', getattr(self.instance, 'is_primary', False))
        if deal and role and is_primary:
            existing = DealContact.objects.filter(deal=deal, role=role, is_primary=True)
            if self.instance:
                existing = existing.exclude(pk=self.instance.pk)
            if existing.exists():
                raise serializers.ValidationError(
                    {'is_primary': 'This deal already has a primary contact for that role.'}
                )
        return attrs
