"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Paystub } from "@/lib/api/tax";
import { formatCurrency, formatDate } from "@/lib/format";

export function PaystubList({
  paystubs,
  onDelete,
  onEdit,
}: {
  paystubs: Paystub[];
  onDelete: (id: string) => void;
  onEdit?: (stub: Paystub) => void;
}) {
  if (paystubs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Paystubs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No paystubs yet. Add your most recent one below — the starred
            figures are enough to start.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Paystubs</CardTitle>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Pay date</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Gross YTD</TableHead>
              <TableHead className="sr-only">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paystubs.map((stub) => (
              <TableRow key={stub.id}>
                <TableCell>{formatDate(stub.pay_date)}</TableCell>
                <TableCell className="text-right">{formatCurrency(stub.gross)}</TableCell>
                <TableCell className="text-right">{formatCurrency(stub.gross_ytd)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  {onEdit && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Correct paystub from ${formatDate(stub.pay_date)}`}
                      onClick={() => onEdit(stub)}
                    >
                      Correct
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Delete paystub from ${formatDate(stub.pay_date)}`}
                    onClick={() => onDelete(stub.id)}
                  >
                    Delete
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
