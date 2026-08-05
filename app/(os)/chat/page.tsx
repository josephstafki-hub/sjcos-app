import { Shell } from "@/components/shell/Shell";
import { ChatClient } from "@/components/chat/ChatClient";
import { getChatData } from "@/lib/chat";

export default async function ChatPage() {
  const data = await getChatData();

  // hideCmd: the channel composer occupies the spot the ⌘K pill floats in.
  return (
    <Shell breadcrumb="TEAM CHAT" hideCmd>
      <ChatClient data={data} />
    </Shell>
  );
}
