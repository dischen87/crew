# Native feedback receipt evidence

This packet records one focused iOS run of the feedback compose path on a dedicated simulator. The run captured a native screenshot, verified that screenshot consent started unchecked and enabled, selected consent, detached transport, performed one submit tap, and reached the local pending receipt.

The four retained Maestro reports all passed. The first screenshot shows the captured preview and selected consent state. The second shows the pending receipt with the explicit copy that text and screenshot are stored locally while delivery remains unconfirmed.

Three temporary constant runtime markers proved the SQLite insert, transaction return, and required-receipt read in that order. Only their counts and order result are retained. The marker instrumentation was removed, and the source file was restored byte-for-byte to its baseline SHA-256.

The reports were sanitized to remove the simulator runtime UUID without changing test outcomes. No raw logs, credentials, private runtime identifiers, or absolute machine paths are retained.

Scope boundaries: this packet does not prove upload delivery, Android behavior, or account switching.
