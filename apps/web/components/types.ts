export type BagRow = {
  id: string; merchant_id: string; title: string; description?: string; original_price: number; sale_price: number;
  quantity_total: number; quantity_left: number; pickup_window?: string; image_url?: string;
  contents?: string[]; available_on?: string; pickup_start_at?: string; pickup_end_at?: string;
  merchant_name?: string; merchant_category?: string; merchant_address?: string; merchant_lat?: number; merchant_lng?: number;
  merchant_logo_url?: string; merchant_rating?: number; merchant_review_count?: number;
};
