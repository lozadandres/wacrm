"use client";

import { Search, SlidersHorizontal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppDispatch, useAppSelector } from "@/store/hooks";
import {
  resetBoardFilters,
  setPriorityFilter,
  setSearch,
  type DealPriorityFilter,
} from "@/store/crm-slice";

const FILTERS: Array<{ value: DealPriorityFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "overdue", label: "Más de 24 h" },
  { value: "unassigned", label: "Sin asignar" },
];

export function BoardFilters() {
  const dispatch = useAppDispatch();
  const { search, priorityFilter } = useAppSelector((state) => state.crm);
  const dirty = search.length > 0 || priorityFilter !== "all";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card/60 p-3">
      <div className="relative min-w-[220px] flex-1 md:max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          aria-label="Buscar clientes o pedidos"
          value={search}
          onChange={(event) => dispatch(setSearch(event.target.value))}
          placeholder="Buscar cliente, teléfono o pedido"
          className="pl-9"
        />
      </div>
      <SlidersHorizontal className="h-4 w-4 text-muted-foreground" />
      {FILTERS.map((filter) => (
        <Button
          key={filter.value}
          type="button"
          size="sm"
          variant={priorityFilter === filter.value ? "default" : "outline"}
          onClick={() => dispatch(setPriorityFilter(filter.value))}
        >
          {filter.label}
        </Button>
      ))}
      {dirty && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => dispatch(resetBoardFilters())}
        >
          <X className="mr-1 h-4 w-4" /> Limpiar
        </Button>
      )}
    </div>
  );
}
