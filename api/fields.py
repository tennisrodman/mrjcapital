import base64
import binascii
import hashlib

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import models


class EncryptedTextField(models.TextField):
    """Text field encrypted at rest with FIELD_ENCRYPTION_KEY."""

    prefix = 'fernet$'

    def get_prep_value(self, value):
        if value in (None, ''):
            return value
        if self._is_encrypted_value(value):
            return value
        value = super().get_prep_value(value)
        token = _fernet().encrypt(str(value).encode('utf-8')).decode('ascii')
        return f'{self.prefix}{token}'

    def from_db_value(self, value, expression, connection):
        return self._decrypt(value)

    def to_python(self, value):
        value = super().to_python(value)
        return self._decrypt(value)

    def _decrypt(self, value):
        if value in (None, ''):
            return value
        if not isinstance(value, str) or not value.startswith(self.prefix):
            return value
        token = value[len(self.prefix):].encode('ascii')
        try:
            return _fernet().decrypt(token).decode('utf-8')
        except InvalidToken as exc:
            raise ValueError('Unable to decrypt encrypted field value') from exc

    def _is_encrypted_value(self, value):
        if not isinstance(value, str) or not value.startswith(self.prefix):
            return False
        token = value[len(self.prefix):].encode('ascii')
        try:
            decoded = base64.urlsafe_b64decode(token)
        except (binascii.Error, ValueError):
            return False
        return len(decoded) > 9 and decoded[0] == 0x80


def _fernet():
    encryption_key = getattr(settings, 'FIELD_ENCRYPTION_KEY', None)
    if not encryption_key:
        raise ImproperlyConfigured('FIELD_ENCRYPTION_KEY must be set for encrypted fields.')
    digest = hashlib.sha256(str(encryption_key).encode('utf-8')).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)
