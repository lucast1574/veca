import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { LEAD_STAGES } from "@veca/content";
import {
  emptyLeadFilters,
  LeadBoard,
  type LeadBoardFilters,
} from "./LeadBoard";
import { LeadDetail } from "./LeadDetail";
import { InventoryWorkspace } from "../warehouse/InventoryWorkspace";

function current() {
  const [view, record, part, workId] = location.hash.slice(1).split("/");
  const stage =
    record === "etapa" && LEAD_STAGES.some((item) => item.id === part)
      ? part
      : "";
  return {
    id: view === "leads" && record !== "etapa" ? record || "" : "",
    proposal: part === "despacho" ? undefined : part,
    dispatchId: part === "despacho" ? workId : undefined,
    stage,
    inventoryTab: record,
    inventoryRecord: part,
    workId,
  };
}

export function Operations({
  view,
  inventoryAccess = true,
  dispatchAccess = false,
  accountingAccess = false,
}: {
  view: "leads" | "inventory";
  inventoryAccess?: boolean;
  dispatchAccess?: boolean;
  accountingAccess?: boolean;
}) {
  const [route, setRoute] = useState(current);
  const [filters, setFilters] = useState<LeadBoardFilters>(() => ({
    ...emptyLeadFilters,
    stage: current().stage,
  }));
  const [page, setPage] = useState(1);
  const boardHash = useRef("leads");
  const boardScroll = useRef<number | null>(null);
  const previousStage = useRef(route.stage);
  useEffect(() => {
    const update = () => {
      const next = current();
      if (next.stage !== previousStage.current && !next.id) {
        setFilters((old) => ({ ...old, stage: next.stage }));
        setPage(1);
      }
      if (!next.id) previousStage.current = next.stage;
      setRoute(next);
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  useLayoutEffect(() => {
    if (view === "leads" && !route.id && boardScroll.current !== null) {
      window.scrollTo({ top: boardScroll.current, behavior: "instant" });
      boardScroll.current = null;
    }
  }, [view, route.id]);
  if (view === "inventory")
    return (
      <InventoryWorkspace
        tab={route.inventoryTab}
        selected={route.inventoryRecord}
        workId={route.workId}
        accountingAccess={accountingAccess}
      />
    );
  return (
    <>
      <div hidden={Boolean(route.id)}>
        <LeadBoard
          filters={filters}
          onFilter={setFilters}
          page={page}
          active={!route.id}
          setPage={setPage}
          open={(id, stage) => {
            boardScroll.current = window.scrollY;
            boardHash.current = location.hash.slice(1) || "leads";
            location.hash = `leads/${id}${stage ? `/${stage}` : ""}`;
          }}
        />
      </div>
      {route.id && (
        <LeadDetail
          key={route.id}
          id={route.id}
          inventoryAccess={inventoryAccess}
          dispatchAccess={dispatchAccess}
          proposal={route.proposal}
          dispatchId={route.dispatchId}
          back={() => {
            location.hash = boardHash.current;
          }}
        />
      )}
    </>
  );
}
