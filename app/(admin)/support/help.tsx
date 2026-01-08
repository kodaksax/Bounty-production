// app/(admin)/support/help.tsx - Admin Help Center
import { MaterialIcons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { AdminHeader } from '../../../components/admin/AdminHeader';

interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  category: string;
}

interface HelpCategory {
  id: string;
  title: string;
  icon: keyof typeof MaterialIcons.glyphMap;
  articles: HelpArticle[];
}

const helpCategories: HelpCategory[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: 'play-arrow',
    articles: [
      { id: '1', title: 'Admin Panel Overview', summary: 'Learn the basics of the admin interface', category: 'getting-started' },
      { id: '2', title: 'Navigating the Dashboard', summary: 'Understanding metrics and quick actions', category: 'getting-started' },
      { id: '3', title: 'Setting Up Your Account', summary: 'Configure your admin profile and preferences', category: 'getting-started' },
    ],
  },
  {
    id: 'user-management',
    title: 'User Management',
    icon: 'people',
    articles: [
      { id: '4', title: 'Managing User Accounts', summary: 'View, edit, and manage user profiles', category: 'user-management' },
      { id: '5', title: 'Suspending & Banning Users', summary: 'How to handle policy violations', category: 'user-management' },
      { id: '6', title: 'User Verification Process', summary: 'Understanding the verification workflow', category: 'user-management' },
    ],
  },
  {
    id: 'bounty-management',
    title: 'Bounty Management',
    icon: 'work',
    articles: [
      { id: '7', title: 'Reviewing Bounties', summary: 'How to moderate and manage bounties', category: 'bounty-management' },
      { id: '8', title: 'Handling Flagged Content', summary: 'Reviewing and resolving flags', category: 'bounty-management' },
      { id: '9', title: 'Bounty Status Transitions', summary: 'Understanding the bounty lifecycle', category: 'bounty-management' },
    ],
  },
  {
    id: 'reports-moderation',
    title: 'Reports & Moderation',
    icon: 'report',
    articles: [
      { id: '10', title: 'Handling User Reports', summary: 'Process for reviewing reported content', category: 'reports-moderation' },
      { id: '11', title: 'Content Moderation Guidelines', summary: 'Policies for content decisions', category: 'reports-moderation' },
      { id: '12', title: 'Escalation Procedures', summary: 'When and how to escalate issues', category: 'reports-moderation' },
    ],
  },
  {
    id: 'transactions',
    title: 'Transactions & Payments',
    icon: 'payment',
    articles: [
      { id: '13', title: 'Understanding Transactions', summary: 'Transaction types and statuses', category: 'transactions' },
      { id: '14', title: 'Refund Process', summary: 'How to process refunds', category: 'transactions' },
      { id: '15', title: 'Dispute Resolution', summary: 'Handling payment disputes', category: 'transactions' },
    ],
  },
];

export default function AdminHelpCenterScreen() {
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedCategory, setExpandedCategory] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<HelpArticle | null>(null);

  const filteredCategories = searchQuery
    ? helpCategories.map(category => ({
        ...category,
        articles: category.articles.filter(
          article =>
            article.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            article.summary.toLowerCase().includes(searchQuery.toLowerCase())
        ),
      })).filter(category => category.articles.length > 0)
    : helpCategories;

  const toggleCategory = (categoryId: string) => {
    setExpandedCategory(expandedCategory === categoryId ? null : categoryId);
  };

  if (selectedArticle) {
    return (
      <View style={styles.container}>
        <AdminHeader 
          title="Help Center" 
          onBack={() => setSelectedArticle(null)} 
        />
        <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
          <View style={styles.articleHeader}>
            <Text style={styles.articleCategory}>{selectedArticle.category.replace(/-/g, ' ')}</Text>
            <Text style={styles.articleTitle}>{selectedArticle.title}</Text>
          </View>
          
          <View style={styles.articleContent}>
            <Text style={styles.articleText}>
              {selectedArticle.summary}
            </Text>
            <Text style={styles.articleText}>
              {'\n'}This is a placeholder for the full article content. In a production environment, 
              this would contain detailed documentation, step-by-step instructions, and helpful 
              screenshots or videos to guide administrators through the process.
            </Text>
            <Text style={styles.articleText}>
              {'\n'}Key points covered in this article:
            </Text>
            <View style={styles.bulletList}>
              <Text style={styles.bulletItem}>• Understanding the feature</Text>
              <Text style={styles.bulletItem}>• Step-by-step instructions</Text>
              <Text style={styles.bulletItem}>• Best practices</Text>
              <Text style={styles.bulletItem}>• Common issues and solutions</Text>
              <Text style={styles.bulletItem}>• Related resources</Text>
            </View>
          </View>

          <View style={styles.articleFooter}>
            <Text style={styles.footerLabel}>Was this article helpful?</Text>
            <View style={styles.feedbackButtons}>
              <TouchableOpacity accessibilityRole="button" style={styles.feedbackButton}>
                <MaterialIcons name="thumb-up" size={20} color="#4caf50" />
                <Text style={styles.feedbackButtonText}>Yes</Text>
              </TouchableOpacity>
              <TouchableOpacity accessibilityRole="button" style={styles.feedbackButton}>
                <MaterialIcons name="thumb-down" size={20} color="#f44336" />
                <Text style={styles.feedbackButtonText}>No</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={{ height: 40 }} />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <AdminHeader title="Help Center" onBack={() => router.back()} />
      <ScrollView style={styles.scrollView} contentContainerStyle={styles.content}>
        {/* Search */}
        <View style={styles.searchContainer}>
          <MaterialIcons name="search" size={20} color="rgba(255,254,245,0.5)" />
          <TextInput accessibilityLabel="Text input field"
            style={styles.searchInput}
            placeholder="Search help articles..."
            placeholderTextColor="rgba(255,254,245,0.4)"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity accessibilityRole="button" onPress={() => setSearchQuery('')}>
              <MaterialIcons name="close" size={20} color="rgba(255,254,245,0.5)" />
            </TouchableOpacity>
          )}
        </View>

        {/* Categories */}
        {filteredCategories.map((category) => (
          <View key={category.id} style={styles.categoryContainer}>
            <TouchableOpacity accessibilityRole="button"
              style={styles.categoryHeader}
              onPress={() => toggleCategory(category.id)}
            >
              <View style={styles.categoryIcon}>
                <MaterialIcons name={category.icon} size={24} color="#00dc50" />
              </View>
              <Text style={styles.categoryTitle}>{category.title}</Text>
              <Text style={styles.articleCount}>{category.articles.length}</Text>
              <MaterialIcons
                name={expandedCategory === category.id ? 'expand-less' : 'expand-more'}
                size={24}
                color="rgba(255,254,245,0.6)"
              />
            </TouchableOpacity>

            {(expandedCategory === category.id || searchQuery) && (
              <View style={styles.articlesList}>
                {category.articles.map((article) => (
                  <TouchableOpacity accessibilityRole="button"
                    key={article.id}
                    style={styles.articleItem}
                    onPress={() => setSelectedArticle(article)}
                  >
                    <View style={styles.articleInfo}>
                      <Text style={styles.articleItemTitle}>{article.title}</Text>
                      <Text style={styles.articleSummary}>{article.summary}</Text>
                    </View>
                    <MaterialIcons name="chevron-right" size={20} color="rgba(255,254,245,0.4)" />
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        ))}

        {filteredCategories.length === 0 && (
          <View style={styles.emptyState}>
            <MaterialIcons name="search-off" size={48} color="rgba(255,254,245,0.3)" />
            <Text style={styles.emptyTitle}>No articles found</Text>
            <Text style={styles.emptyText}>Try a different search term</Text>
          </View>
        )}

        {/* Bottom padding */}
        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a3d2e',
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: 16,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d5240',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginBottom: 20,
    gap: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: '#fffef5',
  },
  categoryContainer: {
    marginBottom: 12,
  },
  categoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
    gap: 12,
  },
  categoryIcon: {
    width: 40,
    height: 40,
    backgroundColor: 'rgba(0,145,44,0.15)',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  categoryTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
  },
  articleCount: {
    fontSize: 13,
    color: 'rgba(255,254,245,0.5)',
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  articlesList: {
    marginTop: 8,
    paddingLeft: 16,
    gap: 8,
  },
  articleItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(45,82,64,0.5)',
    borderRadius: 10,
    padding: 14,
    gap: 12,
  },
  articleInfo: {
    flex: 1,
  },
  articleItemTitle: {
    fontSize: 14,
    fontWeight: '500',
    color: '#fffef5',
    marginBottom: 2,
  },
  articleSummary: {
    fontSize: 12,
    color: 'rgba(255,254,245,0.6)',
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
    gap: 12,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fffef5',
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
  },
  // Article view styles
  articleHeader: {
    marginBottom: 24,
  },
  articleCategory: {
    fontSize: 12,
    color: '#00dc50',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  articleTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#fffef5',
  },
  articleContent: {
    backgroundColor: '#2d5240',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(0,145,44,0.2)',
    marginBottom: 24,
  },
  articleText: {
    fontSize: 15,
    color: 'rgba(255,254,245,0.85)',
    lineHeight: 24,
  },
  bulletList: {
    marginTop: 12,
    gap: 8,
  },
  bulletItem: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.8)',
    paddingLeft: 8,
  },
  articleFooter: {
    alignItems: 'center',
    gap: 12,
  },
  footerLabel: {
    fontSize: 14,
    color: 'rgba(255,254,245,0.6)',
  },
  feedbackButtons: {
    flexDirection: 'row',
    gap: 16,
  },
  feedbackButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d5240',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    gap: 8,
  },
  feedbackButtonText: {
    fontSize: 14,
    color: '#fffef5',
    fontWeight: '500',
  },
});
