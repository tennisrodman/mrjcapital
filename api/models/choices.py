from django.db import models


class InvestmentType(models.TextChoices):
    WHOLE_LOAN_BRIDGE = 'whole_loan_bridge', 'Whole loan bridge'
    WHOLE_LOAN_PERMANENT = 'whole_loan_permanent', 'Whole loan permanent'
    MEZZANINE = 'mezzanine', 'Mezzanine'
    PREFERRED_EQUITY = 'preferred_equity', 'Preferred equity'
    CO_GP_EQUITY = 'co_gp_equity', 'Co-GP equity'
    LP_EQUITY = 'lp_equity', 'LP equity'


class DealPurpose(models.TextChoices):
    ACQUISITION = 'acquisition', 'Acquisition'
    REFINANCE = 'refinance', 'Refinance'
    CONSTRUCTION = 'construction', 'Construction'
    RECAPITALIZATION = 'recapitalization', 'Recapitalization'


class DealProfile(models.TextChoices):
    VALUE_ADD = 'value_add', 'Value-add'
    CONSTRUCTION = 'construction', 'Construction'
    STABILIZED = 'stabilized', 'Stabilized'


class DepositStatus(models.TextChoices):
    PENDING = 'pending', 'Pending'
    RECEIVED = 'received', 'Received'
    APPLIED_TO_CLOSING = 'applied_to_closing', 'Applied to closing'
    REFUNDED = 'refunded', 'Refunded'


class PipelineStatus(models.TextChoices):
    SOURCED = 'sourced', 'Sourced'
    SCREENING = 'screening', 'Screening'
    QUOTING = 'quoting', 'Quoting'
    NEGOTIATING = 'negotiating', 'Negotiating'
    SIGNED = 'signed', 'Signed'
    CLOSING = 'closing', 'Closing'
    CLOSED = 'closed', 'Closed'
    SERVICING = 'servicing', 'Servicing'
    ON_HOLD = 'on_hold', 'On hold'
    DEAD = 'dead', 'Dead'
    EXITED = 'exited', 'Exited'


class SyndicationStatus(models.TextChoices):
    NOT_STARTED = 'not_started', 'Not started'
    RAISING = 'raising', 'Raising'
    FULLY_SUBSCRIBED = 'fully_subscribed', 'Fully subscribed'
    CLOSED = 'closed', 'Closed'


class SourceChannel(models.TextChoices):
    BROKER = 'broker', 'Broker'
    DIRECT = 'direct', 'Direct'
    REFERRAL = 'referral', 'Referral'
    REPEAT_SPONSOR = 'repeat_sponsor', 'Repeat sponsor'
    INTERNAL_PROSPECTING = 'internal_prospecting', 'Internal prospecting'


class PropertyType(models.TextChoices):
    MULTIFAMILY = 'multifamily', 'Multifamily'
    OFFICE = 'office', 'Office'
    RETAIL = 'retail', 'Retail'
    INDUSTRIAL = 'industrial', 'Industrial'
    HOTEL = 'hotel', 'Hotel'
    SELF_STORAGE = 'self_storage', 'Self storage'
    LAND = 'land', 'Land'
    MIXED_USE = 'mixed_use', 'Mixed use'
    DATA_CENTER = 'data_center', 'Data center'
    CONDO = 'condo', 'Condo'
    MASTER_PLANNED_RESIDENTIAL = 'master_planned_residential', 'Master planned residential'
    OTHER = 'other', 'Other'


class PropertyEnvironmentalStatus(models.TextChoices):
    NONE = 'none', 'None identified'
    PHASE_1_CLEAN = 'phase_1_clean', 'Phase I clean'
    PHASE_1_REC = 'phase_1_rec', 'Phase I REC'
    PHASE_2_REQUIRED = 'phase_2_required', 'Phase II required'
    PHASE_2_CLEAN = 'phase_2_clean', 'Phase II clean'
    REMEDIATION = 'remediation', 'Remediation required'


class SponsorEntityType(models.TextChoices):
    LLC = 'llc', 'LLC'
    LP = 'lp', 'LP'
    CORP = 'corp', 'Corporation'
    TRUST = 'trust', 'Trust'
    INDIVIDUAL = 'individual', 'Individual'


class RelationshipRating(models.TextChoices):
    NEW = 'new', 'New'
    DEVELOPING = 'developing', 'Developing'
    ESTABLISHED = 'established', 'Established'
    STRATEGIC = 'strategic', 'Strategic'


class SponsorConnectionSource(models.TextChoices):
    BROKER_REFERRAL = 'broker_referral', 'Broker referral'
    DIRECT = 'direct', 'Direct'
    REPEAT = 'repeat', 'Repeat relationship'
    MARKETING = 'marketing', 'Marketing'
    CONFERENCE = 'conference', 'Conference'


class BrokerCommissionType(models.TextChoices):
    PERCENT_OF_LOAN = 'percent_of_loan', 'Percent of loan'
    FLAT_FEE = 'flat_fee', 'Flat fee'
    PERCENT_OF_EQUITY = 'percent_of_equity', 'Percent of equity'
    REFERRAL_FEE = 'referral_fee', 'Referral fee'


class BrokerStatus(models.TextChoices):
    ACTIVE = 'active', 'Active'
    INACTIVE = 'inactive', 'Inactive'
    BLOCKED = 'blocked', 'Blocked'


class FundStatus(models.TextChoices):
    FORMING = 'forming', 'Forming'
    OPEN = 'open', 'Open'
    CLOSED = 'closed', 'Closed'


class DocumentStorageStatus(models.TextChoices):
    PENDING = 'pending', 'Pending upload'
    READY = 'ready', 'Ready'
    FAILED = 'failed', 'Failed'


class DocumentCategory(models.TextChoices):
    OFFERING_MEMO = 'offering_memo', 'Offering memo'
    FINANCIALS = 'financials', 'Financials'
    RENT_ROLL = 'rent_roll', 'Rent roll'
    APPRAISAL = 'appraisal', 'Appraisal'
    ENVIRONMENTAL = 'environmental', 'Environmental'
    TITLE = 'title', 'Title'
    INSURANCE = 'insurance', 'Insurance'
    LEGAL = 'legal', 'Legal'
    ENTITY_DOCS = 'entity_docs', 'Entity docs'
    CONSTRUCTION = 'construction', 'Construction'
    INVESTOR_DOCS = 'investor_docs', 'Investor docs'
    CORRESPONDENCE = 'correspondence', 'Correspondence'
    CLOSING_DOCS = 'closing_docs', 'Closing docs'
    SERVICING = 'servicing', 'Servicing'
    OTHER = 'other', 'Other'


class ActivityActionType(models.TextChoices):
    STATUS_CHANGE = 'status_change', 'Status change'
    FIELD_UPDATED = 'field_updated', 'Field updated'
    DOCUMENT_UPLOAD = 'document_upload', 'Document upload'
    NOTE_ADDED = 'note_added', 'Note added'
    SENSITIVE_FIELD_READ = 'sensitive_field_read', 'Sensitive field read'
    CLOSING_GENERATED = 'closing_generated', 'Closing checklist generated'
    CLOSING_REGENERATED = 'closing_regenerated', 'Closing checklist regenerated'
    CLOSING_SUPERSEDED = 'closing_superseded', 'Closing checklist superseded'
    CLOSING_ITEM_UPDATED = 'closing_item_updated', 'Closing item updated'
    CLOSING_DOCUMENT_LINKED = 'closing_document_linked', 'Closing document linked'
    CLOSING_DOCUMENT_DETACHED = 'closing_document_detached', 'Closing document detached'
    CLOSING_PACKAGE_UPDATED = 'closing_package_updated', 'Closing package updated'
    QUOTE_CREATED = 'quote_created', 'Quote created'
    QUOTE_UPDATED = 'quote_updated', 'Quote updated'
    QUOTE_SENT = 'quote_sent', 'Quote sent'
    QUOTE_COUNTERED = 'quote_countered', 'Quote countered'
    QUOTE_EXECUTED = 'quote_executed', 'Quote executed'
    QUOTE_EXPIRED = 'quote_expired', 'Quote expired'
    QUOTE_WITHDRAWN = 'quote_withdrawn', 'Quote withdrawn'
    QUOTE_ATTACHMENTS_UPDATED = 'quote_attachments_updated', 'Quote attachments updated'
