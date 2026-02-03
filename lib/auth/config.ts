import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ profile }) {
      const authorized = process.env.AUTHORIZED_EMAIL;
      if (!authorized) return false;
      return profile?.email === authorized;
    },
    async session({ session }) {
      return session;
    },
  },
});
