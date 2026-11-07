import {Shell} from '@/components/shell/Shell';
import {BrowserSettings} from '@/components/panel/BrowserSettings';
import {requireRole} from '@/lib/dal';
export default async function BrowserSettingsPage(){const owner=await requireRole('owner');return <Shell breadcrumb="SETTINGS / BROWSER"><BrowserSettings ownerUserId={owner.id}/></Shell>;}
