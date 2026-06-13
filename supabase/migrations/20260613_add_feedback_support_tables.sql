-- Migration: Add Feedback & Support tables (feedback_reports, feature_requests)
-- Created: 2026-06-13
--
-- Purpose:
--   Backs the new "Feedback & Support" section in Settings. Users can file bug
--   reports and feature requests directly from the app. Submissions are stored
--   here so the team can triage them.
--
-- Tables:
--   feedback_reports  — bug reports (subject, description, optional screenshot,
--                       diagnostic context). Status defaults to 'open'.
--   feature_requests  — feature suggestions (title, description). Status
--                       defaults to 'submitted'.
--
-- Security (RLS):
--   - Users can INSERT their own submissions (user_id must equal auth.uid()).
--   - Users can SELECT only their own submissions.
--   - Admins (profiles.role = 'admin') can SELECT/UPDATE/DELETE all submissions.
--
-- Storage:
--   - Private bucket `feedback-screenshots` for optional bug-report screenshots.
--     Authenticated users may upload into their own `${uid}/...` folder; owners
--     and admins may read.

-- ============================================================================
-- feedback_reports
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.feedback_reports (
    id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    subject        text NOT NULL,
    description    text NOT NULL,
    screenshot_url text,
    app_version    text,
    platform       text,
    status         text NOT NULL DEFAULT 'open'
                     CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
    created_at     timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feedback_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own feedback reports"
    ON public.feedback_reports FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own feedback reports"
    ON public.feedback_reports FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all feedback reports"
    ON public.feedback_reports FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update feedback reports"
    ON public.feedback_reports FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete feedback reports"
    ON public.feedback_reports FOR DELETE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_feedback_reports_user_id ON public.feedback_reports(user_id);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_status  ON public.feedback_reports(status);
CREATE INDEX IF NOT EXISTS idx_feedback_reports_created ON public.feedback_reports(created_at);

-- ============================================================================
-- feature_requests
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.feature_requests (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    title       text NOT NULL,
    description text NOT NULL,
    status      text NOT NULL DEFAULT 'submitted'
                  CHECK (status IN ('submitted', 'planned', 'in_progress', 'completed', 'declined')),
    created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.feature_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own feature requests"
    ON public.feature_requests FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own feature requests"
    ON public.feature_requests FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins can view all feature requests"
    ON public.feature_requests FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can update feature requests"
    ON public.feature_requests FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "Admins can delete feature requests"
    ON public.feature_requests FOR DELETE
    USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

CREATE INDEX IF NOT EXISTS idx_feature_requests_user_id ON public.feature_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_feature_requests_status  ON public.feature_requests(status);
CREATE INDEX IF NOT EXISTS idx_feature_requests_created ON public.feature_requests(created_at);

-- ============================================================================
-- Storage bucket for bug-report screenshots (private)
-- ============================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('feedback-screenshots', 'feedback-screenshots', false)
ON CONFLICT (id) DO NOTHING;

-- Authenticated users may upload screenshots into their own folder (uid/...).
CREATE POLICY "Users can upload their own feedback screenshots"
    ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'feedback-screenshots'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Owners can read their own screenshots.
CREATE POLICY "Users can read their own feedback screenshots"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'feedback-screenshots'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

-- Admins can read all screenshots.
CREATE POLICY "Admins can read all feedback screenshots"
    ON storage.objects FOR SELECT TO authenticated
    USING (
        bucket_id = 'feedback-screenshots'
        AND EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
    );
