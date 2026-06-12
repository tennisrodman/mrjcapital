"""Settings for the automated test suite.

Hermetic by design: an in-memory SQLite database so API/auth tests run
without a live Postgres.

Run with:
    python manage.py test api --settings=mrj.settings.test
"""
from .development import *  # noqa: F401,F403

DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    }
}

PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

STATICFILES_DIRS = []
