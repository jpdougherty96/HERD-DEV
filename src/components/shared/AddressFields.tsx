import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select";
import { usStates } from "../../utils/constants/usStates";
import { cn } from "../../components/ui/utils";

export function AddressFields({ value, onChange }: {
  value: { street: string; city: string; state: string; zipCode: string };
  onChange: (v: typeof value) => void;
}) {
  const handle = (f: keyof typeof value, val: string) =>
    onChange({ ...value, [f]: val });

  // ✅ Updated: fine gray border (0.5px) instead of thick black
  const base =
    "mt-1 h-10 bg-white text-[#1f2b15] border-[0.5px] border-[#d1d5db] px-3 focus:border-black focus:ring-0 focus-visible:ring-4 focus-visible:ring-[#c54a2c]/30 focus-visible:ring-offset-2 focus-visible:ring-offset-white";

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div>
        <Label>Street Address</Label>
        <Input
          className={base}
          value={value.street}
          onChange={(e) => handle("street", e.target.value)}
          required
        />
      </div>
      <div>
        <Label>City</Label>
        <Input
          className={base}
          value={value.city}
          onChange={(e) => handle("city", e.target.value)}
          required
        />
      </div>
      <div>
        <Label>State</Label>
        <Select value={value.state} onValueChange={(v: string) => handle("state", v)}>
          <SelectTrigger className={cn(base, "[&>span]:truncate")}>
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            {usStates.map((s) => (
              <SelectItem key={s.code} value={s.code}>
                {s.code} - {s.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>ZIP/Postal Code</Label>
        <Input
          className={base}
          value={value.zipCode}
          onChange={(e) => handle("zipCode", e.target.value)}
          required
        />
      </div>
    </div>
  );
}
