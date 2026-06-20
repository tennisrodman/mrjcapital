from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import viewsets
from . import views

router = DefaultRouter()
router.register('sponsors', viewsets.SponsorViewSet, basename='sponsor')
router.register('brokers', viewsets.BrokerViewSet, basename='broker')
router.register('funds', viewsets.FundViewSet, basename='fund')
router.register('properties', viewsets.PropertyViewSet, basename='property')
router.register('deals', viewsets.DealViewSet, basename='deal')
router.register('deal-properties', viewsets.DealPropertyViewSet, basename='deal-property')
router.register('documents', viewsets.DocumentViewSet, basename='document')
router.register('activity-logs', viewsets.ActivityLogViewSet, basename='activity-log')

urlpatterns = [
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/user/', views.user_info, name='user_info'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('', include(router.urls)),
    re_path(r'^.*$', views.api_not_found),
]
