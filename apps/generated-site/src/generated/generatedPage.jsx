import { useEffect, useMemo, useState } from "react";
import {
  brand,
  contact,
  heroGallery,
  materials,
  newArrivals,
  proof,
  regularItems,
  serviceHighlights
} from "./catalogData.js";

export const generatedMetadata = {
  instructionHash: "76d271bbb3674083e95217094196ee8273f739d7a895770a93af84050228702a",
  generatedAt: "2026-06-25T00:00:00.000Z",
  title: "Vogue Elegance"
};

const formatInr = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0
  }).format(Number(amount) || 0);

function Icon({ name }) {
  const paths = {
    phone: "M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.48 19.48 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.12.9.33 1.77.63 2.6a2 2 0 0 1-.45 2.11L8.02 9.7a16 16 0 0 0 6.29 6.29l1.27-1.27a2 2 0 0 1 2.11-.45c.83.3 1.7.51 2.6.63A2 2 0 0 1 22 16.92Z",
    whatsapp:
      "M20.52 3.48A11.82 11.82 0 0 0 2.44 17.6L2 22l4.52-1.16A11.82 11.82 0 0 0 20.52 3.48ZM12 20a8 8 0 0 1-4.08-1.12l-.29-.17-2.42.62.65-2.35-.19-.31A8 8 0 1 1 12 20Zm4.44-5.8c-.24-.12-1.43-.7-1.65-.78-.22-.08-.38-.12-.54.12-.16.24-.62.78-.76.94-.14.16-.28.18-.52.06a6.54 6.54 0 0 1-3.24-2.82c-.24-.42.24-.39.68-1.3.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.4-.4-.54-.41h-.46c-.16 0-.42.06-.64.3-.22.24-.84.82-.84 2s.86 2.32.98 2.48c.12.16 1.7 2.59 4.12 3.63.58.25 1.03.4 1.38.51.58.18 1.1.16 1.52.1.46-.07 1.43-.58 1.63-1.14.2-.56.2-1.04.14-1.14-.06-.1-.22-.16-.46-.28Z",
    instagram:
      "M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm5 5.2A4.8 4.8 0 1 0 12 16.8 4.8 4.8 0 0 0 12 7.2Zm0 2A2.8 2.8 0 1 1 12 14.8 2.8 2.8 0 0 1 12 9.2Zm5.1-2.75a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3Z",
    mail: "M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm0 4 8 5 8-5",
    map: "M12 21s7-5.2 7-12A7 7 0 0 0 5 9c0 6.8 7 12 7 12Zm0-9.5A2.5 2.5 0 1 0 12 6a2.5 2.5 0 0 0 0 5.5Z",
    bag: "M6 7h12l1 14H5L6 7Zm3 0a3 3 0 0 1 6 0"
  };

  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="icon">
      <path d={paths[name]} />
    </svg>
  );
}

function ProductCard({ product }) {
  const soldOut = product.stock === 0;

  return (
    <article className={`product-card ${soldOut ? "sold-out" : ""}`}>
      <div className="product-image-wrap">
        <img src={product.image} alt={product.imageAlt} loading="lazy" />
        <span className="source-badge">{product.sourceBrand}</span>
      </div>
      <div className="product-content">
        <div className="product-topline">
          <code>{product.id}</code>
          <span className={`availability ${soldOut ? "is-unavailable" : "is-available"}`}>
            {soldOut ? "Sold out" : product.availability}
          </span>
        </div>
        <h3>{product.name}</h3>
        <p>
          {product.category} in {product.color}. {product.material}. {product.dimensions}.
        </p>
        <div className="price-row">
          <strong>{formatInr(product.price)}</strong>
          <span>{formatInr(product.compareAt)}</span>
        </div>
        <div className="product-actions">
          <a href={product.sourceUrl} target="_blank" rel="noreferrer">
            Item details
          </a>
          <a
            className={soldOut ? "disabled" : ""}
            href={
              soldOut
                ? "#catalog"
                : `${contact.whatsappUrl}?text=${encodeURIComponent(
                    `Hi Vogue Elegance, I want to enquire about ${product.name} (${product.id}).`
                  )}`
            }
          >
            Enquire
          </a>
        </div>
      </div>
    </article>
  );
}

function CatalogSection({ id, eyebrow, title, intro, products }) {
  return (
    <section className="catalog-section" id={id}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2>{title}</h2>
        </div>
        <p>{intro}</p>
      </div>
      <div className="product-grid">
        {products.map((product) => (
          <ProductCard product={product} key={product.id} />
        ))}
      </div>
    </section>
  );
}

function AdminTable({ products }) {
  const [rows, setRows] = useState(products);

  const updateStock = (productId, delta) => {
    setRows((current) =>
      current.map((product) =>
        product.id === productId ? { ...product, stock: Math.max(0, product.stock + delta) } : product
      )
    );
  };

  return (
    <section className="admin-section" id="admin" aria-labelledby="admin-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Admin inventory</p>
          <h2 id="admin-title">Private product controls for Vogue Elegance.</h2>
        </div>
        <p>
          This panel is hidden unless the browser already has an admin session flag. Changes here
          are local to this generated build.
        </p>
      </div>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Product</th>
              <th>Section</th>
              <th>Stock</th>
              <th>Price</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((product) => (
              <tr key={product.id}>
                <td>
                  <strong>{product.name}</strong>
                  <code>{product.id}</code>
                </td>
                <td>{product.id.includes("NA") ? "New arrival" : "Regular"}</td>
                <td>
                  <div className="stock-controls">
                    <button type="button" onClick={() => updateStock(product.id, -1)} aria-label={`Decrease ${product.name}`}>
                      -
                    </button>
                    <span>{product.stock}</span>
                    <button type="button" onClick={() => updateStock(product.id, 1)} aria-label={`Increase ${product.name}`}>
                      +
                    </button>
                  </div>
                </td>
                <td>{formatInr(product.price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ContactLink({ icon, href, label, value }) {
  return (
    <a className="contact-link" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>
      <Icon name={icon} />
      <span>{label}</span>
      <strong>{value}</strong>
    </a>
  );
}

export default function GeneratedPage() {
  const allProducts = useMemo(() => [...newArrivals, ...regularItems], []);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const adminFlag = window.localStorage.getItem("vogueEleganceAdmin") === "true";
    const adminEmail = window.localStorage.getItem("vogueEleganceUserEmail") === brand.adminEmail;
    setIsAdmin(adminFlag || adminEmail);
  }, []);

  return (
    <main className="generated-page">
      <section className="hero-section" id="top">
        <nav className="site-nav" aria-label="Main navigation">
          <a className="brand-lockup" href="#top">
            <span className="brand-mark">VE</span>
            <span>
              <strong>{brand.name}</strong>
              <small>{brand.location}</small>
            </span>
          </a>
          <div className="nav-links">
            <a href="#new-arrivals">New arrivals</a>
            <a href="#regular-items">Regular items</a>
            <a href="#location">Location</a>
            <a href="#contact">Contact</a>
            {isAdmin && <a href="#admin">Admin</a>}
          </div>
        </nav>

        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{brand.eyebrow}</p>
            <h1>{brand.headline}</h1>
            <p>{brand.subhead}</p>
            <div className="hero-actions">
              <a className="button primary" href="#new-arrivals">
                Shop new arrivals
              </a>
              <a className="button secondary" href={contact.whatsappUrl} target="_blank" rel="noreferrer">
                <Icon name="whatsapp" />
                WhatsApp boutique
              </a>
            </div>
          </div>
          <div className="hero-gallery" aria-label="Vogue Elegance bag edit">
            {heroGallery.map((item, index) => (
              <figure className={`hero-photo hero-photo-${index + 1}`} key={item.alt}>
                <img src={item.src} alt={item.alt} />
              </figure>
            ))}
            <div className="hero-note">
              <Icon name="bag" />
              <strong>Vogue Elegance edit</strong>
              <span>New-season bags, local assistance, quick enquiry.</span>
            </div>
          </div>
        </div>

        <div className="proof-strip">
          {proof.map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>

      <section className="intro-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Boutique workflow</p>
            <h2>Browse by arrival status, then enquire directly with the shop.</h2>
          </div>
          <p>
            The public storefront focuses on the customer journey: curated products, clear prices,
            visible contact channels, and a direct Google Maps destination.
          </p>
        </div>
        <div className="highlight-grid">
          {serviceHighlights.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <CatalogSection
        id="new-arrivals"
        eyebrow="New arrivals"
        title="Fresh pieces from the latest arrival edit."
        intro="These cards use current arrival names, prices, sale labels, and locally saved product photos. The item source appears only as a small logo badge on each card."
        products={newArrivals}
      />

      <CatalogSection
        id="regular-items"
        eyebrow="Regular items"
        title="Everyday bags kept separate for faster browsing."
        intro="A concise regular collection for customers who want classic totes, shoulder bags, and neutral quilted options."
        products={regularItems}
      />

      <section className="materials-section" id="materials">
        <div className="section-heading compact">
          <div>
            <p className="eyebrow">Materials and styling</p>
            <h2>Premium, practical, and easy to compare.</h2>
          </div>
        </div>
        <div className="highlight-grid">
          {materials.map((item) => (
            <article key={item.title}>
              <h3>{item.title}</h3>
              <p>{item.body}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="contact-section" id="contact">
        <div className="contact-card">
          <p className="eyebrow">Contact Vogue Elegance</p>
          <h2>{contact.name}</h2>
          <address>{contact.address}</address>
          <div className="contact-grid">
            <ContactLink icon="whatsapp" href={contact.whatsappUrl} label="WhatsApp" value={contact.whatsappDisplay} />
            <ContactLink icon="instagram" href={contact.instagramUrl} label="Instagram" value={contact.instagram} />
            <ContactLink icon="phone" href={`tel:${contact.phoneTel}`} label="Call" value={contact.phoneDisplay} />
            <ContactLink icon="mail" href={`mailto:${contact.email}`} label="Email" value={contact.email} />
            <ContactLink icon="map" href={contact.mapLink} label="Map" value="Open Google Maps" />
          </div>
        </div>

        <aside className="map-card" id="location" aria-label="Google Maps location for Vogue Elegance">
          <div className="map-toolbar">
            <span>Google Maps location</span>
            <a href={contact.mapLink} target="_blank" rel="noreferrer">
              Open map
            </a>
          </div>
          <div className="map-canvas">
            <span className="map-road road-one" />
            <span className="map-road road-two" />
            <span className="map-road road-three" />
            <span className="map-block block-one" />
            <span className="map-block block-two" />
            <span className="map-block block-three" />
            <span className="map-pin">
              <Icon name="bag" />
            </span>
          </div>
          <strong>{contact.mapLabel}</strong>
          <span>{contact.coordinates}</span>
          <p>{contact.category}</p>
        </aside>
      </section>

      <section className="cta-section">
        <div>
          <p className="eyebrow">Visit or message</p>
          <h2>Ready to check color, stock, or pickup timing?</h2>
        </div>
        <a className="button primary" href={contact.whatsappUrl} target="_blank" rel="noreferrer">
          <Icon name="whatsapp" />
          Start WhatsApp enquiry
        </a>
      </section>

      {isAdmin && <AdminTable products={allProducts} />}
    </main>
  );
}
