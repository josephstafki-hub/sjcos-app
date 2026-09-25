"""Validate the planning handoff only; this does not test the application."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
docs = root
files = sorted(docs.glob('*.md'))
PLAN_DOCS = {'AGENT_HANDOFF.md', 'DECISIONS.md', 'DESIGN.md', 'INTEGRATIONS.md', 'OPERATING_AGENTS.md',
             'OWNER_TIME_TRACKING.md', 'README.md', 'STATUS.md', 'TASKS.md', 'VALIDATION.md', 'WORKFLOW.md'}
assert PLAN_DOCS <= {p.name for p in files}, PLAN_DOCS - {p.name for p in files}
# Build-time additions (BUILD.md, agents-md-migration.md, credentials-inventory.md) are
# checked for fences/links/whitespace like the rest but are not planning documents.
for p in files:
    text = p.read_text()
    assert text.count('```') % 2 == 0, f'unclosed fence: {p.name}'
    for target in re.findall(r'\[[^\]]*\]\(([^)]+)\)', text):
        if '://' not in target and not target.startswith('#'):
            assert (p.parent / target.split('#')[0]).exists(), (p.name, target)
    assert not re.search(r'[ \t]+$', text, re.M), f'trailing whitespace: {p}'
    for stale in ['all 26 rows', 'All 26 rows', '26 implementable',
                  'at least 20 eligible cases', 'over at least two business weeks']:
        assert stale not in text, (p.name, stale)

parts = re.split(r'^## (A\d+(?:[ab])?(?:/A\d+)?) — [^\n]+\n',
                 (docs / 'TASKS.md').read_text(), flags=re.M)
tasks = dict(zip(parts[1::2], parts[2::2]))
assert len(tasks) == 28, len(tasks)
status = set(re.findall(r'^\| (A\d+(?:[ab])?(?:/A\d+)?) \|',
                        (docs / 'STATUS.md').read_text(), re.M))
assert status == set(tasks), (status - set(tasks), set(tasks) - status)
dependencies = {}
for name, body in tasks.items():
    assert '**Depends:**' in body and '**Accept:**' in body, name
    dep = body.split('**Depends:**', 1)[1].split('\n\n', 1)[0].split('**Inspect:**', 1)[0]
    dependencies[name] = set(re.findall(r'A05/A06|A\d+(?:[ab])?', dep))
    assert dependencies[name] <= set(tasks), (name, dependencies[name] - set(tasks))
visiting, finished = set(), set()
def visit(task):
    assert task not in visiting, ('cycle', task)
    if task in finished:
        return
    visiting.add(task)
    for dep in dependencies[task]:
        visit(dep)
    visiting.remove(task)
    finished.add(task)
for task in tasks:
    visit(task)
assert len(set(re.findall(r'^\| F\d{2}\b', (docs/'TASKS.md').read_text(), re.M))) == 16
v = (docs/'VALIDATION.md').read_text()
checks = re.findall(r'^\| (V\d{2})\b', v, re.M)
assert len(checks) == len(set(checks)) == 46
assert set(checks) == {f'V{i:02d}' for i in range(1, 47)}
assert len(re.findall(r'^## W\d{2} —', (docs/'WORKFLOW.md').read_text(), re.M)) == 12
for p in files:
    for block in re.findall(r'(?:^\|.*\n)+', p.read_text(), re.M):
        lines = block.strip().splitlines()
        assert len(lines) >= 2 and re.fullmatch(r'[| :\-]+', lines[1]), (p.name, lines[:2])
        cells = len(lines[0].split('|'))
        assert all(len(x.split('|')) == cells for x in lines), (p.name, 'unequal table columns')
read = root/'SJC_OS_Complete_Build_Plan.md'
if read.exists():
    text = read.read_text()
    anchors = set(re.findall(r'<a id="([^"]+)"></a>', text))
    for target in re.findall(r'\[[^\]]*\]\(#([^)]+)\)', text):
        assert target in anchors, ('consolidated anchor', target)
    for p in files:
        assert p.stem.lower().replace('_', '-') in anchors, p.name
print(f'PASS: {len(files)} documents ({len(PLAN_DOCS)} planning); links/fences/tables; 28 matching task/status rows; '
      'acyclic dependencies; 16 audit mappings; 12 workflow stages; 46 verification cases.')
print('Documentation validation only; application and operating-model tests were not run.')
