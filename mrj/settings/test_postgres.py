"""PostgreSQL settings for production-database contract and concurrency tests."""

from .development import *  # noqa: F401,F403
from .base import _database_config


DATABASES = {'default': _database_config()}

PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

STATICFILES_DIRS = []

DOCUMENT_STORAGE_BACKEND = 'local'
