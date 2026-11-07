"""Exercise the real filesystem journal in a private temp tree, never /opt or
/etc. Root-only chown/trust checks are mocked ONLY here, not in the provisioner.
No account tools, runtime installer, database or subprocess are invoked.
"""
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import provision_acceptance as p

class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='browser-provision-test-')
        self.root=Path(self.temp.name)
        self.state=self.root/'state';self.state.mkdir()
        self.patches=[patch.object(p,'STATE',self.state),patch.object(p,'JOURNAL',self.state/'journal.json'),
                      patch.object(p,'trusted',lambda *args,**kwargs:None),patch.object(p.os,'fchown',lambda *args:None)]
        for item in self.patches:item.start()
        self.tx=p.Transaction({'directories':[],'files':{},'permissions':{}})
    def tearDown(self):
        for item in reversed(self.patches):item.stop()
        self.temp.cleanup()
    def test_original_backed_up_before_replace(self):
        file=self.root/'module';file.write_bytes(b'original');file.chmod(0o600)
        self.tx.write(file,b'candidate')
        record=self.tx.state['files'][str(file)]
        self.assertEqual((self.state/('backup-'+record['before']['backup'])).read_bytes(),b'original')
        self.assertEqual(record['before']['mode'],0o600)
        self.assertEqual(record['after'],p.digest(b'candidate'))
    def test_repeat_keeps_original_backup(self):
        file=self.root/'module';file.write_bytes(b'original')
        self.tx.write(file,b'candidate');self.tx.write(file,b'candidate')
        self.assertEqual(self.tx.state['files'][str(file)]['before']['backup'],p.digest(b'original'))
    def test_new_file_has_no_invented_backup(self):
        file=self.root/'module';self.tx.write(file,b'new')
        self.assertIsNone(self.tx.state['files'][str(file)]['before'])
    def test_symlink_refused_without_changing_referent(self):
        target=self.root/'target';target.write_bytes(b'keep')
        link=self.root/'module';link.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError,'DESTINATION_SYMLINK'):self.tx.write(link,b'bad')
        self.assertEqual(target.read_bytes(),b'keep')
    def test_atomic_replace_does_not_mutate_hardlink_referent(self):
        target=self.root/'target';target.write_bytes(b'keep')
        link=self.root/'module';os.link(target,link)
        self.tx.write(link,b'new');self.assertEqual(target.read_bytes(),b'keep')
    def test_created_directories_journaled_parent_first(self):
        parent=self.root/'a';child=parent/'b';self.tx.directory(child)
        self.assertEqual(self.tx.state['directories'],[str(parent),str(child)])
    def test_journal_matches_committed_bytes(self):
        file=self.root/'module';self.tx.write(file,b'candidate')
        journal=json.loads(p.JOURNAL.read_text())
        self.assertEqual(journal['files'][str(file)]['after'],p.digest(file.read_bytes()))
    def test_permissions_cannot_change_without_durable_intent(self):
        file=self.root/'module';file.write_bytes(b'candidate')
        # User-owned fixtures hit the ownership refusal too; no chmod either way.
        mode=file.stat().st_mode
        with self.assertRaises(RuntimeError):self.tx.permissions(file,os.getgid())
        self.assertEqual(file.stat().st_mode,mode)
    def test_external_symlink_cannot_grant_group_access(self):
        target=self.root/'target';target.write_bytes(b'keep')
        link=self.root/'module';link.symlink_to(target)
        with self.assertRaisesRegex(RuntimeError,'EXTERNAL_SYMLINK'):self.tx.permissions(link,os.getgid())

if __name__=='__main__':unittest.main()
