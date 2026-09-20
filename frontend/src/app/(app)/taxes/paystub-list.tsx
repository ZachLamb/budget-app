"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Paystub } from "@/lib/api/tax";
import { formatCurrency, formatDate } from "@/lib/format";

export function PaystubList({
  paystubs,
  onDelete,
}: {
  paystubs: Paystub[];
  onDelete: (id: string) => void;
}) {
  if (paystubs.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Paystubs</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No paystubs added yet. Add your most recent one below.
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
              <TableHead className="sr-only">Delete</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paystubs.map((stub) => (
              <TableRow key={stub.id}>
                <TableCell>{formatDate(stub.pay_date)}</TableCell>
                <TableCell className="text-right">{formatCurrency(stub.gross)}</TableCell>
                <TableCell className="text-right">{formatCurrency(stub.gross_ytd)}</TableCell>
                <TableCell className="text-right">
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
