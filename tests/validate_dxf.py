"""Validate the DXF produced by assets/js/exporters.js.

Usage:
    node tests/export-dxf.js            # writes tests/_out.dxf from Station 1
    python tests/validate_dxf.py        # parses it with ezdxf (pip install ezdxf)

Optional CI dependency: the browser build has no DXF parser, so this check is a
maintainer tool rather than part of the default test run.
"""

import sys
from collections import Counter

import ezdxf

PATH = "tests/_out.dxf"
EXPECTED_LAYERS = {
    "HALL", "WALKWAY", "FENCE", "ROBOT", "MACHINE",
    "FIXTURE", "CONTROLLER", "TROLLEY", "FLOW", "TEXT",
}
failures = []


def check(cond, message):
    print(("  PASS  " if cond else "  FAIL  ") + message)
    if not cond:
        failures.append(message)


doc = ezdxf.readfile(PATH)
msp = doc.modelspace()

print("DXF " + doc.dxfversion + " (AutoCAD " + str(doc.acad_release) + ")")
print("entities:", dict(Counter(e.dxftype() for e in msp)))

check(doc.dxfversion == "AC1009", "R12 format")
check(doc.header.get("$INSUNITS") == 4, "units are millimetres ($INSUNITS = 4)")

layers = {layer.dxf.name for layer in doc.layers}
check(EXPECTED_LAYERS.issubset(layers), "all expected layers exist")
# "0" and "Defpoints" are DXF housekeeping layers created by the format itself
HOUSEKEEPING = {"0", "Defpoints"}
check(not (layers - EXPECTED_LAYERS - HOUSEKEEPING), "no unexpected layers")

kinds = Counter(e.dxftype() for e in msp)
check(kinds["LINE"] > 100, "line entities present (%d)" % kinds["LINE"])
check(kinds["TEXT"] > 10, "text entities present (%d)" % kinds["TEXT"])
check(set(kinds) <= {"LINE", "TEXT"}, "only R12 safe entities used")

xs, ys = [], []
for e in msp:
    if e.dxftype() == "LINE":
        xs += [e.dxf.start.x, e.dxf.end.x]
        ys += [e.dxf.start.y, e.dxf.end.y]

ext = (min(xs), min(ys), max(xs), max(ys))
print("drawn extent:", ext)
check(ext[0] >= -1 and ext[1] >= -1, "geometry starts at the model origin")
check(ext[2] > 20000 and ext[3] > 10000, "geometry spans the hall (mm)")

auditor = doc.audit()
check(len(auditor.errors) == 0, "ezdxf audit reports no errors (%d)" % len(auditor.errors))
for err in auditor.errors[:5]:
    print("    " + str(err))

print("")
if failures:
    print("%d DXF assertion(s) failed" % len(failures))
    sys.exit(1)
print("DXF is valid")
