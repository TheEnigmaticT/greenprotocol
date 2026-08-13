import os

# The chemistry service now fails closed: it refuses to start without
# CHEMISTRY_SERVICE_TOKEN unless CHEMISTRY_SERVICE_ALLOW_ANONYMOUS=1 is set
# (see main.py). Tests exercise the app through TestClient, which triggers the
# startup lifespan, so opt into the local-dev anonymous escape hatch here —
# before main.py is imported and reads it at module load. This keeps production
# fail-closed while letting the suite boot the app.
os.environ.setdefault("CHEMISTRY_SERVICE_ALLOW_ANONYMOUS", "1")
