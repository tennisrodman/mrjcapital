from django.urls import path, re_path
from rest_framework_simplejwt.views import TokenRefreshView

from . import views

urlpatterns = [
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/user/', views.user_info, name='user_info'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    # Add application-specific endpoints here
    re_path(r'^.*$', views.api_not_found),
]
