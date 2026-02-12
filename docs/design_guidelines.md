# Design Guidelines: DocPythia Documentation Platform

## Design Approach

**Selected Approach:** Design System with Documentation Best Practices  
**Primary References:** Linear, Stripe, and Vercel documentation patterns  
**Rationale:** Technical documentation requires clarity, consistency, and excellent readability. The admin dashboard needs professional data visualization while maintaining the same visual language.

## Core Design Elements

### A. Color Palette

**Dark Mode (Primary):**
- Background: 222 15% 8% (deep neutral, not pure black)
- Surface: 222 15% 12% (elevated cards/sections)
- Surface Elevated: 222 15% 16% (modals, dropdowns)
- Border: 222 12% 20% (subtle divisions)
- Text Primary: 0 0% 95% (high contrast)
- Text Secondary: 0 0% 70% (less important info)
- Text Muted: 0 0% 50% (metadata, timestamps)

**Brand Colors:**
- Primary: 185 85% 55% (Teal/cyan - for CTAs, links)
- Primary Hover: 185 85% 48%
- Success: 142 76% 45% (approved changes)
- Warning: 38 92% 50% (pending review)
- Danger: 0 84% 60% (rejected, critical info)

**Light Mode:**
- Background: 0 0% 98%
- Surface: 0 0% 100%
- Text Primary: 222 15% 15%
- Maintain same hue relationships for brand colors with adjusted lightness

### B. Typography

**Font Families:**
- Headings: `'Inter', sans-serif` (700 weight for h1/h2, 600 for h3-h6)
- Body: `'Inter', sans-serif` (400 regular, 500 medium)
- Code/Technical: `'JetBrains Mono', 'Fira Code', monospace`

**Scale:**
- H1: text-4xl md:text-5xl (landing hero only)
- H2: text-2xl md:text-3xl (page titles)
- H3: text-xl md:text-2xl (section headers)
- H4: text-lg md:text-xl (subsections)
- Body: text-base (16px)
- Small: text-sm (metadata, captions)
- Code: text-sm

### C. Layout System

**Spacing Primitives:** Use Tailwind units of 2, 4, 6, 8, 12, 16, 20, 24 for consistency
- Component padding: p-4 to p-6
- Section spacing: py-12 to py-16
- Container gaps: gap-4, gap-6, gap-8

**Container Strategy:**
- Documentation: max-w-5xl mx-auto (optimal reading width)
- Admin Dashboard: max-w-7xl mx-auto (more space for tables/data)
- Code blocks: full-width within content container
- Sidebars: w-64 (navigation), w-80 (table of contents)

### D. Component Library

**Documentation Page Components:**

1. **Navigation Header**
   - Fixed top bar with logo, main nav links, theme toggle, search bar
   - Sticky behavior on scroll
   - Height: h-16
   - Background: Surface with backdrop-blur

2. **Sidebar Navigation**
   - Left sidebar for docs hierarchy
   - Collapsible sections with chevron icons
   - Active state: Primary color + bold weight
   - Nested indentation: pl-4 for each level

3. **Content Area**
   - Max-width prose container
   - Clear heading hierarchy
   - Inline code: bg-surface px-1.5 py-0.5 rounded
   - Code blocks: bg-surface p-4 rounded-lg with syntax highlighting
   - Info callouts: border-l-4 with colored borders, bg-surface/50

4. **Table of Contents**
   - Right sidebar (desktop only)
   - Text-sm with smooth scroll behavior
   - Highlight current section

**Admin Dashboard Components:**

1. **Dashboard Header**
   - Breadcrumb navigation
   - Action buttons (New Review, Settings)
   - Stats overview cards

2. **Update Queue Cards**
   - Card design with subtle border
   - Update type badge (Minor/Major)
   - Timestamp and source indicator
   - Diff preview (collapsed by default)
   - Action buttons: Approve (primary), Reject (outline), View Details

3. **Diff Viewer**
   - Split view: before (red tint) | after (green tint)
   - Line-by-line comparison
   - Syntax highlighting for code changes
   - Unified view option

4. **Version History**
   - Timeline view with connecting lines
   - Commit-style entries with author, time, change summary
   - Expandable details

5. **Data Tables**
   - Striped rows for readability
   - Sortable headers with icons
   - Filter inputs at column level
   - Pagination controls

### E. Landing Page Design

**Hero Section:**
- Height: min-h-screen with centered content
- Background: Subtle gradient from background to surface
- No hero image (keep focus on content)
- Large heading + subheading + primary CTA
- Trust indicator: "Powering X validators" stat

**Sections:**
- Node Types Grid (3 columns): Cards for Validator/RPC/Archival with icons
- AI-Powered Updates: Visual showing scrape → analyze → update flow
- Feature Highlights: 4-item grid showcasing key capabilities
- Getting Started CTA: Dark surface card with contrast

### F. Special Patterns

**Status Indicators:**
- Pending: Warning color with animated pulse
- Approved: Success color with checkmark icon
- Rejected: Danger color with X icon
- Auto-applied: Muted with automation icon

**Badges:**
- Rounded-full px-3 py-1 text-sm
- Color-coded by category
- Subtle background, bold text

**Interactive Elements:**
- Subtle hover states: slight scale or color shift
- Focus rings: ring-2 ring-primary/50
- Smooth transitions: transition-all duration-200

### G. Animations

**Minimal, Purposeful:**
- Page transitions: Fade in only (no slide)
- Loading states: Subtle skeleton screens, no spinners unless necessary
- Diff reveal: Smooth expand/collapse
- Avoid: Parallax, scroll-triggered animations, excessive motion

## Images

**Landing Page Hero:**
- Abstract visualization of network nodes/validation (optional)
- If used: Full-width but max height of 60vh, subtle overlay for text readability
- Alternative: Pure gradient background with geometric patterns

**Documentation Diagrams:**
- Architecture diagrams for node types
- Flow charts for validation process
- Use muted colors consistent with palette

## Page-Specific Notes

**Documentation Pages:**
- Single column focus, no distractions
- Generous line-height (1.7) for readability
- Clear visual separation between sections
- Persistent navigation for easy jumping

**Admin Dashboard:**
- Multi-column layouts (2-3 columns) for efficiency
- Data density balanced with whitespace
- Quick action buttons always accessible
- Real-time update indicators

**Mobile Responsiveness:**
- Stack multi-column layouts to single column
- Collapsible sidebars with hamburger menu
- Touch-friendly button sizes (min h-12)
- Simplified diff view on small screens