---
title: "Java to LLMs: Exploring the LLMs Fundamentals"
description: "As a long-time Java developer, I’ve always enjoyed the world of programming. Recently, I found myself increasingly curious about LLMs. It…"
publishDate: 2025-02-25
tags:
  - java
  - llm
draft: false
---

![](https://cdn-images-1.medium.com/max/800/1*CFHapu-ZrcBDRXS-KquiZw.png)

[Watch the playlist on YouTube](https://www.youtube.com/playlist?list=PLpxcSt9FGVVERRWBvQ8I4k8poVqQVwydm)

As a long-time Java developer, I’ve always enjoyed the world of programming. Recently, I found myself increasingly curious about LLMs. It has really become impossible to ignore advances in AI space.

Here I’m sharing my personal journey as I started exploring Large Language Models (LLMs).

If you’re a developer like me, confused with buzz words but eager to understand how modern language models work without diving into heavy hands-on coding right away, this might resonate with you.

**Part 1: Diving into AI, ML, and Data Fundamentals**

I started by revisiting some core concepts.

- **What is AI?**
Coming from a Java background, I was used to writing explicit instructions in code. AI, however, is about creating systems that learn from data rather than following hard-coded rules.
- **Machine Learning & Deep Learning**
ML intrigued me because it’s all about algorithms that improve over time. I learned that while traditional programming relies on clear logic, ML uses statistical methods to find patterns. Deep Learning took it a step further by mimicking the human brain with neural networks.
- **Understanding NLP**
Natural Language Processing (NLP) was a particularly interesting area. NLP enables machines to understand and generate human language, a huge leap from the type-safe code I’m used to in Java.
- **Models and Data**
I learned that an ML model is essentially a function that transforms input into output by learning from data. A key takeaway was the difference between labeled and unlabeled data. While labeled data comes with predefined answers (like data for classification tasks), unlabeled data is used for self-supervised learning. This concept was a refreshing contrast to the deterministic behavior of traditional Java programs.

**Part 2: Tokens, Embeddings, and Transformers**

Once I had the fundamentals in place, I began exploring the inner workings of language models — a natural progression given my newfound interest in NLP.

- **Tokens and Embeddings**
I discovered that before any text can be processed by a machine, it must be broken down into small units called tokens. Think of it as parsing a sentence in Java — each token is like a word or subword, a manageable piece of data. These tokens are then transformed into embeddings, which are numerical representations in a high-dimensional space. In simpler terms, embeddings capture the essence or meaning of a word, allowing the model to understand relationships between words — much like how data structures in Java can represent complex relationships in code.
- **Transformers and Attention**
The next major breakthrough was understanding transformers. Unlike older models that processed text sequentially, transformers look at an entire sentence at once, using something called the attention mechanism. This allows the model to weigh the importance of each word relative to others, ensuring context is preserved.
- **A High-Level Look at Consuming LLMs via APIs**
Finally, I learned that you don’t always need to build these models from scratch. Many companies now offer powerful LLMs through APIs. As a developer, this means you can integrate cutting-edge AI capabilities into your projects without dealing with the heavy lifting of training and maintaining the models yourself. It’s a bit like using a trusted Java library — someone else has done the hard work, and you just plug it into your application.

I’m excited about where this exploration will lead next, especially as I start experimenting with more hands-on approaches and practical applications.

Stay tuned for more updates!

If you’re curious about these topics or have insights from your own experiences, I’d love to hear from you.

Happy coding and exploring!
