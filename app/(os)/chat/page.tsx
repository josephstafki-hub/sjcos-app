import { Shell } from "@/components/shell/Shell";
import { ChatClient } from "@/components/chat/ChatClient";
import { getChatData } from "@/lib/chat";

export default async function ChatPage() {
  const data = await getChatData();

  return (
    <Shell breadcrumb="TEAM CHAT">
      <ChatClient data={data} />
    </Shell>
  );
}
