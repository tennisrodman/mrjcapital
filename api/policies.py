"""Small, dependency-light authorization policies shared across API features."""


def is_staff_user(user) -> bool:
    return bool(
        user
        and getattr(user, 'is_authenticated', False)
        and (getattr(user, 'is_staff', False) or getattr(user, 'is_superuser', False))
    )


def can_access_deal(user, deal) -> bool:
    if not user or not getattr(user, 'is_authenticated', False):
        return False
    return is_staff_user(user) or deal.assigned_analyst_id == getattr(user, 'id', None)
