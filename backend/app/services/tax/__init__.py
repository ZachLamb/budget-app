"""Pure tax calculation. No database session, no network, no clock.

Everything in this package is a function of its arguments. That is what
makes the engine testable against published IRS examples and what lets
the phase 3 optimizer re-run it safely with perturbed inputs.
"""
