import os

from django.contrib.auth import get_user_model
from django.core.exceptions import ImproperlyConfigured


class MCPAuthError(ImproperlyConfigured):
    """Raised when the local MCP user is missing or not allowed."""


def resolve_mcp_user():
    user_id = os.environ.get('MRJ_MCP_USER_ID')
    username = os.environ.get('MRJ_MCP_USERNAME')
    if user_id:
        return _resolve_by_id(user_id)
    if username:
        return _resolve_by_username(username)
    raise MCPAuthError('MRJ MCP requires MRJ_MCP_USER_ID or MRJ_MCP_USERNAME.')


def require_staff_user(user):
    if not getattr(user, 'is_authenticated', False):
        raise MCPAuthError('MRJ MCP requires an authenticated staff user.')
    if not getattr(user, 'is_active', False):
        raise MCPAuthError('MRJ MCP user must be active.')
    if not _is_staff_user(user):
        raise MCPAuthError('MRJ MCP user must be staff or superuser.')
    return user


def _resolve_by_id(user_id):
    try:
        normalized_id = int(str(user_id))
    except (TypeError, ValueError) as exc:
        raise MCPAuthError('MRJ_MCP_USER_ID must be an integer user id.') from exc
    user_model = get_user_model()
    try:
        user = user_model.objects.get(pk=normalized_id)
    except user_model.DoesNotExist as exc:
        raise MCPAuthError(f'MRJ MCP user id {normalized_id} was not found.') from exc
    return require_staff_user(user)


def _resolve_by_username(username):
    user_model = get_user_model()
    try:
        user = user_model.objects.get(username=username)
    except user_model.DoesNotExist as exc:
        raise MCPAuthError(f'MRJ MCP username {username!r} was not found.') from exc
    return require_staff_user(user)


def _is_staff_user(user):
    return bool(getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False))
