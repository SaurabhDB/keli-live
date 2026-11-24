"""Keli Live: live road-surface conditions for every Finnish road camera.

Data: Fintraffic / digitraffic.fi, license CC 4.0 BY.
"""

from importlib.metadata import version

__version__ = version("keli-live")

# Sent as the Digitraffic-User header on every request (Digitraffic asks clients to identify).
USER_AGENT = f"KeliLive/{__version__}"

ATTRIBUTION = "Source: Fintraffic / digitraffic.fi, license CC 4.0 BY"
