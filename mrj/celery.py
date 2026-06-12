import os
from celery import Celery

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'mrj.settings.development')

app = Celery('mrj')
app.config_from_object('django.conf:settings', namespace='CELERY')
app.autodiscover_tasks()
