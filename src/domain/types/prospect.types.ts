export interface CreatedProspect {
  id: string;
  name: string;
  phone: string | null;
  user_id: string;
  location: { lat: number; lng: number };
  created_at: string;
  captured_at: string;
  status: string | null;
}
