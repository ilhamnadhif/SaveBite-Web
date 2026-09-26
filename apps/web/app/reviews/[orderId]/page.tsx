"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ArrowLeft, Star } from "lucide-react";
import { PageHeading, Panel, describeError, useAsyncData } from "@savebite/web-shared";
import { supabaseBrowser } from "@savebite/web-shared/client";
import { shortDate } from "@savebite/web-shared";

const TAGS = ["Enak", "Porsi pas", "Pickup mudah", "Kemasan baik", "Harga hemat"];
const MAX_COMMENT = 500;

export default function ReviewPage() {
  const { orderId } = useParams<{ orderId: string }>();
  const router = useRouter();
  const [rating, setRating] = useState(5);
  const [selected, setSelected] = useState<string[]>([]);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const { data: order } = useAsyncData<Record<string, unknown> | null>(
    async () => {
      const { data, error: queryError } = await supabaseBrowser()
        .from("consumer_orders")
        .select("*")
        .eq("id", orderId)
        .maybeSingle();
      if (queryError) throw queryError;
      return data as Record<string, unknown> | null;
    },
    { deps: [orderId], scope: "review.load", initialData: null },
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (rating < 1 || rating > 5) {
      setError("Pilih rating antara 1 sampai 5.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error: rpcError } = await supabaseBrowser().rpc("submit_review", {
        p_order_id: orderId,
        p_rating: rating,
        p_tags: selected,
        p_comment: comment.trim().slice(0, MAX_COMMENT),
      });
      if (rpcError) throw rpcError;
      router.push("/orders");
    } catch (caught) {
      setError(describeError(caught, "review.submit", { orderId }));
    } finally {
      setBusy(false);
    }
  }

  const merchantName = typeof order?.merchant_name === "string" ? order.merchant_name : undefined;

  return <>
    <Link href="/orders" className="back-link"><ArrowLeft size={15}/>Kembali ke pesanan</Link>
    <PageHeading
      eyebrow="BAGIKAN PENGALAMAN"
      title="Bagaimana bag kamu?"
      description={merchantName ? `Pesanan di ${merchantName}${typeof order?.created_at === "string" ? ` · ${shortDate(order.created_at)}` : ""}.` : "Ulasan membantu toko meningkatkan layanan."}
    />
    <Panel className="review-form-panel">
      <form onSubmit={(event) => void submit(event)}>
        <div className="rating-picker" role="radiogroup" aria-label="Pilih rating">
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              type="button"
              key={value}
              role="radio"
              aria-checked={value === rating}
              aria-label={`${value} bintang`}
              onClick={() => setRating(value)}
              className={value <= rating ? "selected" : ""}
            >
              <Star size={28} fill={value <= rating ? "currentColor" : "none"}/>
            </button>
          ))}
        </div>
        <div className="field">
          <label id="review-tags-label">Apa yang paling kamu suka?</label>
          <div className="review-tags" role="group" aria-labelledby="review-tags-label">
            {TAGS.map((tag) => (
              <button
                type="button"
                className={selected.includes(tag) ? "selected" : ""}
                key={tag}
                aria-pressed={selected.includes(tag)}
                onClick={() => setSelected((current) => (current.includes(tag) ? current.filter((item) => item !== tag) : [...current, tag]))}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="comment">Ceritakan sedikit (opsional)</label>
          <textarea
            id="comment"
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={MAX_COMMENT}
            placeholder="Bagikan pengalamanmu dengan komunitas SaveBite."
          />
          <small>{comment.length}/{MAX_COMMENT}</small>
        </div>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="button button-primary" disabled={busy}>{busy ? "Mengirim…" : "Kirim ulasan"}</button>
      </form>
    </Panel>
  </>;
}
