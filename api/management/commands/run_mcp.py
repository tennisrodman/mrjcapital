import logging
import sys

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Run the local read-only MRJ MCP server over stdio.'
    requires_system_checks = []
    requires_migrations_checks = False

    def handle(self, *args, **options):
        logging.basicConfig(stream=sys.stderr)
        from api.mcp.server import run_stdio

        run_stdio()
