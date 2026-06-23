from django.core.management.base import BaseCommand

from api.demo_seed import seed_demo_data


class Command(BaseCommand):
    help = 'Load shared demo deal data from shared/demo_seed.json into the database.'

    def handle(self, *args, **options):
        seed_demo_data(stdout=self.stdout)
