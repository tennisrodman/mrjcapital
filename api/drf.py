"""Shared DRF request parsing and Django validation translation helpers."""

from uuid import UUID

from rest_framework import status
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response


def uuid_filter_value(value, field_name):
    try:
        return UUID(str(value))
    except (TypeError, ValueError) as exc:
        raise DRFValidationError({field_name: 'Invalid UUID.'}) from exc


def boolean_filter_value(value, field_name):
    normalized = str(value).lower()
    if normalized in {'1', 'true'}:
        return True
    if normalized in {'0', 'false'}:
        return False
    raise DRFValidationError({field_name: 'Expected true or false.'})


def raise_drf_validation(exc):
    if hasattr(exc, 'message_dict'):
        raise DRFValidationError(exc.message_dict) from exc
    raise DRFValidationError({'detail': exc.messages}) from exc


def django_validation_response(exc):
    if hasattr(exc, 'message_dict'):
        body = dict(exc.message_dict)
        readiness = getattr(exc, 'readiness', None)
        if readiness is not None:
            body['readiness'] = readiness
        return Response(body, status=status.HTTP_400_BAD_REQUEST)
    return Response({'detail': list(exc.messages)}, status=status.HTTP_400_BAD_REQUEST)
