"""Pure tax calculation. No database session, no network, no clock.

Everything in this package is a function of its arguments. That is what
makes the engine testable against published IRS examples and what lets
the phase 3 optimizer re-run it safely with perturbed inputs.
"""
from app.services.tax.engine import impact_of, project
from app.services.tax.inputs import (
    Change,
    ExplainStep,
    ExtraBusinessExpense,
    ExtraItemizedDeduction,
    ExtraPretax401k,
    ExtraPretaxHsa,
    ExtraWages,
    SafeHarborResult,
    ScheduleEResult,
    TaxInputs,
    TaxProjection,
    WithholdingBuckets,
)
from app.services.tax.rates.registry import (
    FilingStatus,
    RateSet,
    UnknownTaxYearError,
    UnsupportedFilingStatusError,
    get_rates,
)

__all__ = [
    "Change", "ExplainStep", "ExtraBusinessExpense", "ExtraItemizedDeduction",
    "ExtraPretax401k", "ExtraPretaxHsa", "ExtraWages", "FilingStatus",
    "RateSet", "SafeHarborResult", "ScheduleEResult", "TaxInputs",
    "TaxProjection", "UnknownTaxYearError", "UnsupportedFilingStatusError",
    "WithholdingBuckets", "get_rates", "impact_of", "project",
]
