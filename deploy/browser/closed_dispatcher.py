"""Fail-closed dispatcher, installed BEFORE importing/constructing DumpMaster.
mitmproxy normally logs addon exceptions and continues. Remove that behavior:
any exception (including option/config/addon load) kills all connections, then
raises a BaseException past safecall; no optional hot reload/removal allowed.
Only used by an attested dedicated launcher, never monkey-patch shared packages.
"""
import contextlib
import os

class GateFatal(BaseException):
    pass

def install(addonmanager, kill_all):
    if getattr(addonmanager, "_sjc_closed", False):
        raise GateFatal("BROWSER_DISPATCHER_DUPLICATE")

    @contextlib.contextmanager
    def closed_safecall():
        try:
            yield
        except BaseException:
            try:
                kill_all()
            except BaseException:
                # Hard exit closes sockets even if trusted cleanup itself fails.
                os._exit(78)
            raise GateFatal("BROWSER_ADDON_FAILED") from None

    addonmanager.safecall = closed_safecall
    addonmanager._sjc_closed = True

def seal(master, required_addon, kill_all):
    """Dedicated launcher calls after loading mandatory addon, BEFORE accept.
    Every later dispatch checks exact addon identities; prevents hot removal,
    reload, optional script injection and a swallowed AddonHalt bypass.
    """
    manager = master.addons
    expected = tuple(manager.chain)
    if required_addon not in expected or getattr(manager, "_sjc_sealed", False):
        raise GateFatal("BROWSER_ADDON_UNATTESTED")
    old_async, old_sync = manager.trigger_event, manager.trigger

    def check():
        if tuple(manager.chain) != expected:
            try:
                kill_all()
            except BaseException:
                os._exit(78)
            raise GateFatal("BROWSER_ADDON_SET_CHANGED")

    async def trigger_event(event):
        check()
        try:
            await old_async(event)
        except BaseException:
            kill_all()
            raise GateFatal("BROWSER_ADDON_FAILED") from None
        check()

    def trigger(event):
        check()
        try:
            old_sync(event)
        except BaseException:
            kill_all()
            raise GateFatal("BROWSER_ADDON_FAILED") from None
        check()

    manager.trigger_event, manager.trigger = trigger_event, trigger
    manager._sjc_sealed = True
