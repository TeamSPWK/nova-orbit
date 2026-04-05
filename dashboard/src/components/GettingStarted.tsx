import { useTranslation } from "react-i18next";
import { WelcomeGuide } from "./WelcomeGuide";

interface GettingStartedProps {
  onClose?: () => void;
}

export function GettingStarted({ onClose }: GettingStartedProps) {
  const { t } = useTranslation();

  return (
    <div className="max-w-3xl mx-auto py-8 px-6">
      {onClose && (
        <button
          onClick={onClose}
          className="flex items-center gap-1 mb-6 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-colors"
        >
          {t("backToProject")}
        </button>
      )}

      {/* Welcome card — always visible from guide page */}
      <div className="mb-8 flex justify-center">
        <div className="w-full max-w-sm">
          <WelcomeGuide embedded />
        </div>
      </div>

      <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2">
        {t("guideTitle")}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 mb-8">
        {t("guideSubtitle")}
      </p>

      <div className="space-y-8">
        {/* Step 1 */}
        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-[#25253d]">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-blue-500 text-white flex items-center justify-center text-sm font-bold shrink-0">1</span>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t("guideStep1Title")}</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-11">
            {t("guideStep1Detail")}
          </p>
        </section>

        {/* Step 2 */}
        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-[#25253d]">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-purple-500 text-white flex items-center justify-center text-sm font-bold shrink-0">2</span>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t("guideStep2Title")}</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-11">
            {t("guideStep2Detail")}
          </p>
        </section>

        {/* Step 3 */}
        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-[#25253d]">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-green-500 text-white flex items-center justify-center text-sm font-bold shrink-0">3</span>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t("guideStep3Title")}</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-11">
            {t("guideStep3Detail")}
          </p>
        </section>

        {/* Step 4 */}
        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-[#25253d]">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-orange-500 text-white flex items-center justify-center text-sm font-bold shrink-0">4</span>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t("guideStep4Title")}</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-11">
            {t("guideStep4Detail")}
          </p>
        </section>

        {/* Step 5 */}
        <section className="border border-gray-200 dark:border-gray-700 rounded-lg p-5 bg-white dark:bg-[#25253d]">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-full bg-red-500 text-white flex items-center justify-center text-sm font-bold shrink-0">5</span>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">{t("guideStep5Title")}</h2>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-400 ml-11">
            {t("guideStep5Detail")}
          </p>
        </section>
      </div>

      {/* Tips */}
      <div className="mt-8 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-400 mb-2">{t("guideTipsTitle")}</h3>
        <ul className="text-xs text-blue-600 dark:text-blue-300 space-y-1.5">
          <li>{t("guideTip1")}</li>
          <li>{t("guideTip2")}</li>
          <li>{t("guideTip3")}</li>
        </ul>
      </div>
    </div>
  );
}
