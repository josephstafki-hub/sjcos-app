import { Shell } from "@/components/shell/Shell";
import { ChatClient } from "@/components/chat/ChatClient";
import { chatViewerFor, getChatData } from "@/lib/chat";
import { requireAccess } from "@/lib/dal";

export default async function ChatPage() {
  // Chat is per-person now: channels for everyone, rooms you've been added to,
  // and the DMs you're a party to (lib/chat.ts).
  const data = await getChatData(await chatViewerFor(await requireAccess("chat")));

  return (
    <Shell breadcrumb="TEAM CHAT">
      <ChatClient data={data} />
    </Shell>
  );
}
