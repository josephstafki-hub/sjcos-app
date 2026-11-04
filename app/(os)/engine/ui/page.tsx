import { Shell } from "@/components/shell/Shell";
import { requireRole } from "@/lib/dal";
import { UiGallery } from "./UiGallery";

export const dynamic = "force-dynamic";

export default async function UiGalleryPage() {
  await requireRole("owner");
  return <Shell breadcrumb="OPERATIONS ENGINE · UI"><UiGallery /></Shell>;
}
