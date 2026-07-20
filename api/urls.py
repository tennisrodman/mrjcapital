from django.urls import include, path, re_path
from rest_framework.routers import DefaultRouter
from rest_framework_simplejwt.views import TokenRefreshView

from . import viewsets
from . import views
from .closing_viewsets import (
    ClosingChecklistGenerationViewSet,
    ClosingPackageViewSet,
    ConditionPrecedentViewSet,
    DDChecklistItemViewSet,
    DDTemplateViewSet,
)
from .contact_viewsets import ContactViewSet, DealContactViewSet
from .quote_viewsets import QuoteViewSet
from .screening_viewsets import ScreeningAssessmentViewSet

router = DefaultRouter()
router.register('sponsors', viewsets.SponsorViewSet, basename='sponsor')
router.register('brokers', viewsets.BrokerViewSet, basename='broker')
router.register('funds', viewsets.FundViewSet, basename='fund')
router.register('properties', viewsets.PropertyViewSet, basename='property')
router.register('deals', viewsets.DealViewSet, basename='deal')
router.register('deal-properties', viewsets.DealPropertyViewSet, basename='deal-property')
router.register('documents', viewsets.DocumentViewSet, basename='document')
router.register('deal-notes', viewsets.DealNoteViewSet, basename='deal-note')
router.register('activity-logs', viewsets.ActivityLogViewSet, basename='activity-log')
router.register('contacts', ContactViewSet, basename='contact')
router.register('deal-contacts', DealContactViewSet, basename='deal-contact')
router.register('screening-assessments', ScreeningAssessmentViewSet, basename='screening-assessment')
router.register('quotes', QuoteViewSet, basename='quote')
router.register('dd-templates', DDTemplateViewSet, basename='dd-template')
router.register('closing-packages', ClosingPackageViewSet, basename='closing-package')
router.register('closing-generations', ClosingChecklistGenerationViewSet, basename='closing-generation')
router.register('dd-checklist-items', DDChecklistItemViewSet, basename='dd-checklist-item')
router.register('conditions-precedent', ConditionPrecedentViewSet, basename='condition-precedent')

urlpatterns = [
    path('auth/login/', views.login_view, name='login'),
    path('auth/logout/', views.logout_view, name='logout'),
    path('auth/user/', views.user_info, name='user_info'),
    path('auth/token/refresh/', TokenRefreshView.as_view(), name='token_refresh'),
    path('', include(router.urls)),
    re_path(r'^.*$', views.api_not_found),
]
