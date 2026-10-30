"use client";
import { useTransition } from "react";
import { Star } from "lucide-react";
import { Button } from "@/components/ui";
import { toggleVendorFav } from "@/lib/actions/vendors";
import { runAction } from "@/lib/run-action";
export function VendorHeaderEdit({
  slug,
  fav,
}: {
  slug: string;
  fav: boolean;
}) {
  const [pending, start] = useTransition();
  return (
    <Button
      variant="secondary"
      icon={Star}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await runAction(async () => {
            await toggleVendorFav(slug);
            return { ok: true };
          });
        })
      }
    >
      {fav ? "Unfavorite" : "Favorite"}
    </Button>
  );
}
