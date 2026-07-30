export default function MarketingFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-6 text-center text-sm text-slate-500">
      <p className="font-semibold text-brand-700">Commonwealth Inspection Services, LLC.</p>
      <p className="mt-1">
        <a href="tel:617-390-4778" className="hover:text-brand-600">617-390-4778</a>
        {" · "}
        <a href="mailto:maasbestos@gmail.com" className="hover:text-brand-600">maasbestos@gmail.com</a>
      </p>
      <p className="mt-1">Serving Massachusetts</p>
      <p className="mt-3 text-xs text-slate-400">
        © {new Date().getFullYear()} Commonwealth Inspection Services, LLC. All rights reserved.
      </p>
    </footer>
  );
}
