export default function MarketingFooter() {
  return (
    <footer className="flex h-[38px] items-center border-t-4 border-brand-700 bg-brand-50 px-4 text-sm text-brand-700 sm:h-[40.5px] md:h-[45px]">
      <div className="mx-auto max-w-4xl w-full">
        <p className="whitespace-nowrap text-right text-[11px] text-brand-700 sm:text-sm">
          © {new Date().getFullYear()} Commonwealth Inspection Services, LLC — All rights reserved.
        </p>
      </div>
    </footer>
  );
}
