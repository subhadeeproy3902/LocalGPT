import ChatInterface from "@/components/chatarea";

export default function Home() {
  return (
    <main className="flex h-screen flex-col bg-[#121212] text-white">
      <div className="w-full max-w-3xl mx-auto flex flex-col h-full justify-between">
        <ChatInterface />
      </div>
    </main>
  );
}
