"use client";

import { useState, useEffect } from "react";
import { SocketProvider, useSocket } from "@/lib/socket-context";
import { Sidebar } from "@/components/sidebar";
import { StatusBar } from "@/components/status-bar";
import { DashboardView } from "@/components/views/dashboard-view";
import { ConnectionsView } from "@/components/views/connections-view";
import { CampaignView } from "@/components/views/campaign-view";
import { SettingsView } from "@/components/views/settings-view";
import { getStatus } from "@/lib/api";

function AppContent() {
  const [currentRoute, setCurrentRoute] = useState("dashboard");
  const [queueData, setQueueData] = useState({ current: 0, total: 0 });

  // Load saved route on mount
  useEffect(() => {
    const savedRoute = localStorage.getItem("smart_dispatcher_route");
    if (savedRoute) {
      setCurrentRoute(savedRoute);
    }
  }, []);

  // Save route on change
  useEffect(() => {
    localStorage.setItem("smart_dispatcher_route", currentRoute);
  }, [currentRoute]);

  const { socket } = useSocket(); // Access socket for real-time triggers

  useEffect(() => {
    let timeoutId: NodeJS.Timeout;
    let isMounted = true;

    async function loadQueue() {
      try {
        const status = await getStatus();
        if (isMounted) {
            setQueueData({
                current: status.queue_current,
                total: status.queue_total,
            });
        }
        // Poll every 5s as fallback/sync
        if (isMounted) timeoutId = setTimeout(loadQueue, 5000);
      } catch (error: any) {
        // console.error("[App] Queue Poll Error:", error.message);
        if (isMounted) timeoutId = setTimeout(loadQueue, 30000);
      }
    }

    loadQueue();

    // Socket Listeners for Real-time updates
    if (socket) {
        const handleUpdate = () => {
            // Slight delay to allow backend state to settle
            setTimeout(loadQueue, 100); 
        };
        
        // Update on any message status change or campaign start/end
        socket.on("message_status", handleUpdate);
        socket.on("campaign_started", handleUpdate);
        socket.on("campaign_finished", handleUpdate);
        socket.on("queue_update", (payload: any) => {
             if (isMounted) {
                 setQueueData({
                     current: payload.current,
                     total: payload.total
                 });
             }
        });

        return () => {
             isMounted = false;
             clearTimeout(timeoutId);
             socket.off("message_status", handleUpdate);
             socket.off("campaign_started", handleUpdate);
             socket.off("campaign_finished", handleUpdate);
             socket.off("queue_update");
        };
    }

    return () => {
        isMounted = false;
        clearTimeout(timeoutId);
    };
  }, [socket]);

  const renderView = () => {
    switch (currentRoute) {
      case "dashboard":
        return <DashboardView />;
      case "connections":
        return <ConnectionsView />;
      case "campaign":
        return <CampaignView onRouteChange={setCurrentRoute} />;
      case "settings":
        return <SettingsView />;
      default:
        return <DashboardView />;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar currentRoute={currentRoute} onRouteChange={setCurrentRoute} />

      <div className="lg:pl-64">
        <StatusBar
          queueCurrent={queueData.current}
          queueTotal={queueData.total}
        />

        <main className="p-6">{renderView()}</main>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <SocketProvider>
      <AppContent />
    </SocketProvider>
  );
}
