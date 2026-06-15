import { Shell } from "@/components/shell/Shell";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { getSettingsData } from "@/lib/settings";

export default async function SettingsPage() {
  const data = await getSettingsData();

  return (
    <Shell breadcrumb="SETTINGS · WORKSPACE" hideCmd>
      <SettingsClient data={data} />
    </Shell>
  );
}
