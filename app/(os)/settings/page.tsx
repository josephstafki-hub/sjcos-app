import { Shell } from "@/components/shell/Shell";
import { SettingsClient } from "@/components/settings/SettingsClient";
import { getSettingsData } from "@/lib/settings";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
  const { section } = await searchParams;
  const data = await getSettingsData();

  return (
    <Shell breadcrumb="SETTINGS">
      <SettingsClient key={section ?? "profile"} data={data} initialSection={data.categories.some(c => c.id === section) ? section : "profile"} />
    </Shell>
  );
}
