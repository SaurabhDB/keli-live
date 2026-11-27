"""Exception hierarchy for Keli Live."""


class KeliError(Exception):
    """Base for all Keli Live errors."""


class DigitrafficError(KeliError):
    """A Digitraffic request failed or returned data we cannot use."""


class DataValidationError(KeliError):
    """External data did not match the expected shape."""


class StorageError(KeliError):
    """Writing to or reading from object storage failed."""
