"use client";

import { MessageSquareQuote, Star } from "lucide-react";
import { EmptyState, Metric, PageHeading, Panel, useAsyncData } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { shortDate } from "@savebite/web-shared";

type Review = {
  review_id: string;
  order_id: string;
  order_reference: string;
  customer_name: string;
  rating: number;
  tags: string[];
  comment: string;
  created_at: string;
};

export default function ReviewsPage() {
  const { data: reviews, loading, error, reload } = useAsyncData<Review[]>(
    async () => {
      const { data, error: rpcError } = await supabaseBrowser().rpc("get_my_merchant_reviews");
      if (rpcError) throw rpcError;
      return (data ?? []) as Review[];
    },
    { scope: "merchantReviews.load", initialData: [] },
  );

  const rows = reviews ?? [];
  const average = rows.length ? rows.reduce((sum, review) => sum + Number(review.rating || 0), 0) / rows.length : 0;

  return <>
    <PageHeading eyebrow="SUARA PELANGGAN" title="Ulasan toko" description="Masukan pelanggan setelah menyelesaikan pickup."/>
    <div className="metric-grid">
      <Metric label="Rating rata-rata" value={rows.length ? average.toFixed(1) + " / 5" : "—"} hint="Dari pesanan yang sudah selesai" icon={<Star size={16}/>}/>
      <Metric label="Jumlah ulasan" value={String(rows.length)} hint="Ulasan konsumen" accent="gold" icon={<MessageSquareQuote size={16}/>}/>
    </div>
    {error && <div className="alert alert-error" role="alert">{error} <button className="text-link" onClick={reload}>Coba lagi</button></div>}
    {loading && !rows.length ? (
      <div className="loading-screen" aria-busy="true"><span className="spinner"/>Memuat ulasan…</div>
    ) : rows.length ? (
      <div className="review-list">
        {rows.map((review) => (
          <Panel key={review.review_id} className="merchant-review">
            <div className="review-head">
              <div className="review-customer">
                <span aria-hidden="true">{(review.customer_name || "P").slice(0, 1).toUpperCase()}</span>
                <div>
                  <strong>{review.customer_name}</strong>
                  <small>Order #{review.order_reference} · {shortDate(review.created_at)}</small>
                </div>
              </div>
              <div className="review-rating">
                <span aria-label={`${review.rating} dari 5 bintang`}>{"★".repeat(Math.round(review.rating))}{"☆".repeat(Math.max(0, 5 - Math.round(review.rating)))}</span>
                <strong>{review.rating}.0</strong>
              </div>
            </div>
            {review.tags?.length > 0 && <div className="review-tag-list">{review.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>}
            {review.comment && <blockquote>“{review.comment}”</blockquote>}
          </Panel>
        ))}
      </div>
    ) : (
      <EmptyState title="Belum ada ulasan" detail="Ulasan akan tampil setelah pelanggan selesai mengambil pesanannya."/>
    )}
  </>;
}
